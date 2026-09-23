package main

import (
	"errors"
	"net/http"
	"strings"
)

// As rotas da economia: catalogo, carteira, partidas, loja e anuncios.
//
// Toda resposta que muda saldo devolve a carteira inteira. O app so mostra o que
// o servidor responde — ele nunca faz a conta por conta propria, nem para
// adiantar o numero na tela.

func (a *API) runRules() RunRules {
	return RunRules{
		MaxPoints:          a.cfg.MaxRunPoints,
		MinSecondsPerPoint: a.cfg.MinSecondsPerPoint,
		MaxDuration:        a.cfg.MaxRunDuration,
		EnforceIntegrity:   a.integrity.Enforcing(),
	}
}

func runIDFrom(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, ok := normalizeUUID(r.PathValue("id"))
	if !ok {
		badRequest(w, "partida inválida")
	}
	return id, ok
}

func (a *API) catalog(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, CurrentCatalog())
}

func (a *API) wallet(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	wallet, err := a.store.Wallet(r.Context(), p.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": wallet})
}

// ------------------------------------------------------------------ partidas

func (a *API) startRun(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	run, wallet, err := a.store.StartRun(r.Context(), p.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run, "wallet": wallet})
}

func (a *API) finishRun(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	id, ok := runIDFrom(w, r)
	if !ok {
		return
	}

	var body struct {
		Points       int   `json:"points"`
		CoinOrdinals []int `json:"coinOrdinals"`
		FlightMs     int64 `json:"flightMs"`
	}
	// Um numero por moeda pega: uma partida longa, pegando letras inteiras, passa
	// facil dos 8 KB dos outros pedidos.
	if !decodeMax(w, r, &body, 256<<10) {
		return
	}
	// Nao cabe mais moeda do que letras inteiras em todos os obstaculos: lista
	// maior que isso nem e lida.
	if len(body.CoinOrdinals) > (a.cfg.MaxRunPoints+1)*MaxLetterCoins {
		badRequest(w, "moedas demais")
		return
	}

	verdict, ok := a.checkFinishIntegrity(w, r, p.ID, id, body.Points, body.FlightMs, body.CoinOrdinals)
	if !ok {
		return
	}

	res, wallet, err := a.store.FinishRun(r.Context(), p.ID, id, body.Points, body.CoinOrdinals, body.FlightMs, verdict, a.runRules(), CurrentSeason())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": res, "wallet": wallet})
}

// checkFinishIntegrity roda a verificacao de integridade (integrity.go) de um
// fechamento — so de partida que rendeu algo e ainda esta aberta: repetir um
// fechamento ja gravado nao gasta outra verificacao.
//
// Com o enforce ligado, problema do NOSSO lado (Google fora, credencial) nao
// fecha a partida: responde 503, e o app tenta de novo mais tarde.
func (a *API) checkFinishIntegrity(w http.ResponseWriter, r *http.Request, playerID, runID string, points int, flightMs int64, ordinals []int) (IntegrityVerdict, bool) {
	if a.integrity.Mode() == IntegrityOff {
		return IntegrityVerdict{Status: "off"}, true
	}
	if points <= 0 && len(ordinals) == 0 {
		return IntegrityVerdict{Status: "skipped"}, true
	}
	aberta, err := a.store.RunIsOpen(r.Context(), playerID, runID)
	if err != nil {
		a.fail(w, r, err)
		return IntegrityVerdict{}, false
	}
	if !aberta {
		// Ja fechada (ou nem existe): o FinishRun responde sem precisar do Google.
		return IntegrityVerdict{Status: "skipped"}, true
	}

	verdict := a.integrity.Check(r.Context(), r.Header.Get("X-Integrity-Token"), FinishHash(runID, points, flightMs, ordinals))
	if verdict.Status == "error" {
		a.log.Error("verificacao de integridade indisponivel", "modo", a.integrity.Mode(), "erro", verdict.Reason)
		if a.integrity.Enforcing() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "Não deu para guardar seu voo agora. Tente de novo em instantes.",
				"code":  "integrity_unavailable",
			})
			return IntegrityVerdict{}, false
		}
	}
	return verdict, true
}

func (a *API) continueRun(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	id, ok := runIDFrom(w, r)
	if !ok {
		return
	}

	var body struct {
		Method string `json:"method"`
	}
	if !decode(w, r, &body) {
		return
	}

	usadas, wallet, err := a.store.ContinueRun(r.Context(), p.ID, id, body.Method, a.runRules())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"continuesUsed": usadas, "wallet": wallet})
}

func (a *API) useShield(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	id, ok := runIDFrom(w, r)
	if !ok {
		return
	}
	wallet, err := a.store.UseShield(r.Context(), p.ID, id, a.runRules())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": wallet})
}

// ---------------------------------------------------------------------- loja

func (a *API) buy(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	var body struct {
		Item   string `json:"item"`
		BirdID string `json:"birdId"`
	}
	if !decode(w, r, &body) {
		return
	}
	wallet, err := a.store.Buy(r.Context(), p.ID, body.Item, body.BirdID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": wallet})
}

// upgradeBird compra a proxima estrela de um passaro, em moedas.
func (a *API) upgradeBird(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	var body struct {
		BirdID string `json:"birdId"`
	}
	if !decode(w, r, &body) {
		return
	}
	wallet, err := a.store.UpgradeBird(r.Context(), p.ID, body.BirdID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": wallet})
}

// purchaseBird troca uma compra com dinheiro (Google Play) pelo passaro dela.
//
// Repetir e seguro: a mesma compra devolve a mesma carteira. E tambem o caminho
// da restauracao — o app reinstalado manda as compras que o Google ainda
// guarda, e o passaro volta para a conta nova (purchases.go).
func (a *API) purchaseBird(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	var body struct {
		BirdID        string `json:"birdId"`
		PurchaseToken string `json:"purchaseToken"`
	}
	if !decode(w, r, &body) {
		return
	}
	b, ok := birdByID(body.BirdID)
	if !ok || b.ProductID == "" {
		a.fail(w, r, ruleCode(404, "bird_not_found", "pássaro não encontrado"))
		return
	}
	token := strings.TrimSpace(body.PurchaseToken)
	if token == "" || len(token) > 2048 {
		badRequest(w, "compra inválida")
		return
	}
	if !a.billing.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Compras com dinheiro indisponíveis agora. Tente mais tarde.",
			"code":  "billing_unavailable",
		})
		return
	}

	compra, err := a.billing.Purchase(r.Context(), b.ProductID, token)
	if errors.Is(err, errPurchaseNotFound) {
		a.fail(w, r, ruleCode(422, "purchase_invalid", "não encontramos esta compra"))
		return
	}
	if err != nil {
		a.log.Error("compra: o Google nao respondeu", "produto", b.ProductID, "erro", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Não deu para concluir sua compra agora. Tente de novo em instantes.",
			"code":  "billing_unavailable",
		})
		return
	}
	switch compra.PurchaseState {
	case 0:
	case 2:
		// Pagamento pendente (boleto, por exemplo): o passaro vem quando aprovar.
		writeJSON(w, http.StatusAccepted, map[string]any{"pending": true})
		return
	default:
		a.fail(w, r, ruleCode(409, "purchase_canceled", "esta compra foi cancelada"))
		return
	}

	wallet, err := a.store.GrantBirdPurchase(r.Context(), p.ID, b.ID, token, compra)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	// Confirma no Google: compra nao confirmada em 3 dias volta para o
	// comprador. O app confirma tambem, depois desta resposta — se aqui falhar,
	// la resolve.
	if compra.AcknowledgementState == 0 {
		if err := a.billing.Acknowledge(r.Context(), b.ProductID, token); err != nil {
			a.log.Warn("compra: nao deu para confirmar no Google", "produto", b.ProductID, "erro", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": wallet, "birdId": b.ID})
}

func (a *API) equipBird(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	var body struct {
		BirdID string `json:"birdId"`
	}
	if !decode(w, r, &body) {
		return
	}
	wallet, err := a.store.EquipBird(r.Context(), p.ID, body.BirdID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": wallet})
}

// ------------------------------------------------------------------ anuncios

// claimAd troca um video confirmado pelo premio. Sem confirmacao ainda, 202:
// o app espera um instante e pede de novo.
func (a *API) claimAd(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	var body struct {
		Kind string `json:"kind"`
	}
	if !decode(w, r, &body) {
		return
	}

	wallet, pendente, err := a.store.ClaimAd(r.Context(), p.ID, body.Kind, a.cfg.AdsDevAutoVerify)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if pendente {
		writeJSON(w, http.StatusAccepted, map[string]any{"pending": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"wallet": wallet, "kind": body.Kind})
}

// admobSSV recebe o aviso do Google de que um video premiado terminou.
//
// Responde 200 para tudo o que nao adianta repetir (assinatura ruim, jogador
// desconhecido, aviso repetido): o Google reenvia quando nao recebe 200, e
// reenviar lixo nao ajuda ninguem. So problema DESTE lado — banco fora, chaves
// do Google inacessiveis — responde erro, justamente para o aviso bom voltar.
func (a *API) admobSSV(w http.ResponseWriter, r *http.Request) {
	cb, err := a.ssv.Verify(r.Context(), r.URL.RawQuery)
	if errors.Is(err, errKeysUnavailable) {
		a.log.Error("ssv: chaves do AdMob inacessiveis", "erro", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false})
		return
	}
	if err != nil {
		a.log.Warn("ssv recusado", "motivo", err.Error())
		writeJSON(w, http.StatusOK, map[string]any{"ok": false})
		return
	}

	playerID, ok := normalizeUUID(cb.UserID)
	if !ok || cb.TransactionID == "" {
		a.log.Warn("ssv sem jogador ou sem transacao")
		writeJSON(w, http.StatusOK, map[string]any{"ok": false})
		return
	}

	novo, err := a.store.RecordAdView(r.Context(), playerID, cb)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "new": novo})
}

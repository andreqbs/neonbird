package main

import (
	"errors"
	"net/http"
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
	}
	if !decode(w, r, &body) {
		return
	}
	// Nao cabe mais moeda do que obstaculo: lista maior que isso nem e lida.
	if len(body.CoinOrdinals) > a.cfg.MaxRunPoints+1 {
		badRequest(w, "moedas demais")
		return
	}

	res, wallet, err := a.store.FinishRun(r.Context(), p.ID, id, body.Points, body.CoinOrdinals, a.runRules(), CurrentSeason())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": res, "wallet": wallet})
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

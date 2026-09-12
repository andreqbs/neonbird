package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
)

// A API do jogo: conta, economia, grupos e ranking.
//
// Tudo aqui responde JSON e nunca devolve erro cru: ou vem o dado, ou vem
// `{"error": "texto em portugues", "code": "..."}`, que a tela mostra sem
// traduzir. Quem chama e um jogo no meio de uma partida — ele nao tem o que
// fazer com um stack trace.

type API struct {
	store *Store
	cfg   Config
	log   *slog.Logger
	ssv   *SSVVerifier
}

func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", a.health)

	mux.HandleFunc("POST /v1/players", a.registerPlayer)

	// Economia (api_economy.go). Nao existe mais rota que aceite um placar
	// solto: ponto e moeda so entram fechando uma partida aberta no servidor.
	mux.HandleFunc("GET /v1/catalog", a.catalog)
	mux.HandleFunc("GET /v1/me/wallet", a.wallet)
	mux.HandleFunc("POST /v1/me/bird", a.equipBird)
	mux.HandleFunc("POST /v1/shop/buy", a.buy)
	mux.HandleFunc("POST /v1/runs/start", a.startRun)
	mux.HandleFunc("POST /v1/runs/{id}/finish", a.finishRun)
	mux.HandleFunc("POST /v1/runs/{id}/continue", a.continueRun)
	mux.HandleFunc("POST /v1/runs/{id}/shield", a.useShield)
	mux.HandleFunc("POST /v1/ads/claim", a.claimAd)
	mux.HandleFunc("GET /v1/ads/ssv", a.admobSSV)

	mux.HandleFunc("GET /v1/groups/me", a.myGroup)
	mux.HandleFunc("POST /v1/groups", a.createGroup)
	mux.HandleFunc("POST /v1/groups/members", a.addMember)
	mux.HandleFunc("DELETE /v1/groups/me", a.leaveGroup)

	mux.HandleFunc("GET /v1/rankings/players", a.topPlayers)
	mux.HandleFunc("GET /v1/rankings/groups", a.topGroups)
	mux.HandleFunc("GET /v1/me/standing", a.standing)

	return mux
}

// -------------------------------------------------------------------- saida

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// fail traduz o erro para o jogador.
//
// Regra de negocio sobe com o texto dela ("o grupo já tem 8 jogadores") e, se
// tiver, com o codigo que o app usa para decidir. O resto vira 500 com uma
// frase generica: mensagem de banco na tela nao ajuda ninguem e conta demais
// sobre o servidor. O detalhe fica no log.
func (a *API) fail(w http.ResponseWriter, r *http.Request, err error) {
	var regra *ruleError
	if errors.As(err, &regra) {
		body := map[string]string{"error": regra.Message}
		if regra.Code != "" {
			body["code"] = regra.Code
		}
		writeJSON(w, regra.Status, body)
		return
	}
	a.log.Error("falha ao atender", "path", r.URL.Path, "erro", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro no servidor"})
}

func badRequest(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
}

// decode le o corpo com teto de tamanho e recusa campo desconhecido — corpo
// gigante e campo inventado sao as duas primeiras coisas que alguem tenta.
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		badRequest(w, "corpo inválido")
		return false
	}
	return true
}

// --------------------------------------------------------------- identidade

// auth confere o par (codigo, segredo) que vem nos cabecalhos.
//
// Nao ha token nem sessao de proposito: o aparelho e a conta, e o par cabe em
// dois cabecalhos que o jogo ja tem na memoria. Um token daria refresh, relogio
// e mais uma coisa para quebrar offline.
func (a *API) auth(w http.ResponseWriter, r *http.Request) (Player, bool) {
	id, okID := normalizeUUID(r.Header.Get("X-Player-Id"))
	secret := r.Header.Get("X-Player-Secret")
	if !okID || secret == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sem identificação"})
		return Player{}, false
	}

	p, err := a.store.Authenticate(r.Context(), id, secret)
	if err != nil {
		a.fail(w, r, err)
		return Player{}, false
	}
	return p, true
}

// ------------------------------------------------------------------ rotas

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Ping(r.Context()); err != nil {
		a.log.Error("banco fora", "erro", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": "banco indisponível",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "season": CurrentSeason()})
}

func (a *API) registerPlayer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID     string `json:"id"`
		Secret string `json:"secret"`
		Name   string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}

	id, ok := normalizeUUID(body.ID)
	if !ok {
		badRequest(w, "código inválido")
		return
	}
	if len(body.Secret) < 8 {
		badRequest(w, "segredo inválido")
		return
	}
	nome, ok := sanitizeName(body.Name, PlayerNameMax)
	if !ok {
		badRequest(w, "escolha um nome com pelo menos 2 letras")
		return
	}

	p, err := a.store.RegisterPlayer(r.Context(), id, body.Secret, nome)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"player": p, "season": CurrentSeason()})
}

func (a *API) myGroup(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	g, err := a.store.MyGroup(r.Context(), p.ID, CurrentSeason())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": g})
}

func (a *API) createGroup(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}
	nome, ok := sanitizeName(body.Name, GroupNameMax)
	if !ok {
		badRequest(w, "dê um nome com pelo menos 2 letras")
		return
	}

	g, err := a.store.CreateGroup(r.Context(), p.ID, nome, CurrentSeason())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": g})
}

func (a *API) addMember(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}

	var body struct {
		PlayerID string `json:"playerId"`
	}
	if !decode(w, r, &body) {
		return
	}
	alvo, ok := normalizeUUID(body.PlayerID)
	if !ok {
		badRequest(w, "código do jogador inválido")
		return
	}

	nome, err := a.store.AddMember(r.Context(), p.ID, alvo, CurrentSeason())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"added": nome})
}

func (a *API) leaveGroup(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	if err := a.store.LeaveGroup(r.Context(), p.ID, CurrentSeason()); err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// limitParam le ?limit=N com teto — sem isso um pedido pede o ranking inteiro.
func limitParam(r *http.Request, padrao, teto int) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n <= 0 {
		return padrao
	}
	if n > teto {
		return teto
	}
	return n
}

func (a *API) topPlayers(w http.ResponseWriter, r *http.Request) {
	season := CurrentSeason()
	rows, err := a.store.TopPlayers(r.Context(), season.ID, limitParam(r, 50, 200))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "season": season})
}

func (a *API) topGroups(w http.ResponseWriter, r *http.Request) {
	season := CurrentSeason()
	rows, err := a.store.TopGroups(r.Context(), season.ID, limitParam(r, 50, 200))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "season": season})
}

func (a *API) standing(w http.ResponseWriter, r *http.Request) {
	p, ok := a.auth(w, r)
	if !ok {
		return
	}
	season := CurrentSeason()
	st, err := a.store.Standing(r.Context(), p.ID, season.ID)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"standing": st, "season": season})
}

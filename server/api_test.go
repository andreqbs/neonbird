package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// Testes de ponta a ponta: HTTP de verdade contra um Postgres de verdade.
//
// Sem `TEST_DATABASE_URL` eles se pulam sozinhos, entao `go test ./...` continua
// funcionando em qualquer maquina. Com Docker:
//
//	docker compose -f docker-compose.test.yml run --rm --build test
//
// Banco de mentira nao serviria aqui: metade das regras deste servidor (um
// grupo por rodada, a carteira travada durante a compra) mora em indice e em
// SQL, e e justamente essa metade que precisa ser conferida.

type ambiente struct {
	srv   *httptest.Server
	store *Store
	cfg   Config

	// Fazem o papel da chave do Google nos avisos de anuncio (ssv_test.go).
	chave *ecdsa.PrivateKey
	keyID int64
}

func novoAmbiente(t *testing.T, ajusta func(*Config)) *ambiente {
	t.Helper()

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("sem TEST_DATABASE_URL: teste com banco pulado")
	}

	// O relogio nao conta nos testes (MinSecondsPerPoint 0): partida aberta e
	// fechada no mesmo milissegundo precisa valer. O teste do placar rapido
	// demais liga o piso de proposito.
	cfg := Config{MaxRunPoints: 2000, MinSecondsPerPoint: 0, MaxRunDuration: time.Hour}
	if ajusta != nil {
		ajusta(&cfg)
	}

	ctx := context.Background()
	store, err := OpenStore(ctx, url)
	if err != nil {
		t.Fatalf("abrir banco: %v", err)
	}
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("migrar: %v", err)
	}
	// Cada teste comeca com o banco limpo: saldo herdado de outro teste da
	// falso positivo dos bons (passa por acaso).
	if _, err := store.pool.Exec(ctx, `
		truncate player_access, ad_views, ledger, game_sessions, owned_birds, wallets,
		         runs, group_members, groups, players
		restart identity cascade`); err != nil {
		t.Fatalf("limpar: %v", err)
	}

	chave := novaChave(t)
	const keyID = 424242
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	integridade, err := NewIntegrityVerifier(cfg)
	if err != nil {
		t.Fatalf("verificacao de integridade: %v", err)
	}
	api := &API{
		store:     store,
		cfg:       cfg,
		log:       log,
		ssv:       &SSVVerifier{keys: chavesFixas{keyID: &chave.PublicKey}},
		integrity: integridade,
		// Sem intervalo entre as idas ao banco: cada pedido do teste conta.
		access: newAccessLog(store, log, 0),
	}
	srv := httptest.NewServer(api.Routes())
	t.Cleanup(func() {
		srv.Close()
		store.Close()
	})
	return &ambiente{srv: srv, store: store, cfg: cfg, chave: chave, keyID: keyID}
}

// A rodada fecha domingo as 18h e so reabre as 20h. Nessas duas horas o
// servidor nao poe pontos no ranking de proposito — e os testes de ranking nao
// teriam o que provar.
func exigeRodadaAberta(t *testing.T) {
	t.Helper()
	if !CurrentSeason().Open {
		t.Skip("rodada em apuracao (domingo 18h-20h): nada entra no ranking agora")
	}
}

type jogador struct{ id, secret, nome string }

func (a *ambiente) chama(t *testing.T, quem *jogador, metodo, caminho string, corpo any) (int, map[string]any) {
	t.Helper()

	var body io.Reader
	if corpo != nil {
		bruto, err := json.Marshal(corpo)
		if err != nil {
			t.Fatalf("montar corpo: %v", err)
		}
		body = bytes.NewReader(bruto)
	}

	req, err := http.NewRequest(metodo, a.srv.URL+caminho, body)
	if err != nil {
		t.Fatalf("montar pedido: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if quem != nil {
		req.Header.Set("X-Player-Id", quem.id)
		req.Header.Set("X-Player-Secret", quem.secret)
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("chamar %s %s: %v", metodo, caminho, err)
	}
	defer res.Body.Close()

	var out map[string]any
	bruto, _ := io.ReadAll(res.Body)
	if len(bruto) > 0 {
		_ = json.Unmarshal(bruto, &out)
	}
	return res.StatusCode, out
}

func (a *ambiente) registra(t *testing.T, nome string) jogador {
	t.Helper()
	j := jogador{id: newUUID(), secret: newUUID(), nome: nome}
	st, body := a.chama(t, nil, "POST", "/v1/players", map[string]any{
		"id": j.id, "secret": j.secret, "name": nome,
	})
	if st != 200 {
		t.Fatalf("registrar %s: status %d (%v)", nome, st, body)
	}
	return j
}

// pontua joga uma partida do jeito que o app joga: abre no servidor (gasta uma
// vida) e fecha com o placar.
func (a *ambiente) pontua(t *testing.T, quem jogador, pontos int) {
	t.Helper()
	id, _ := a.abrePartida(t, quem)
	if st, body := a.fechaPartida(t, quem, id, pontos, nil); st != http.StatusOK {
		t.Fatalf("%s pontuar %d: status %d (%v)", quem.nome, pontos, st, body)
	}
}

func num(t *testing.T, v any) int {
	t.Helper()
	f, ok := v.(float64)
	if !ok {
		t.Fatalf("esperava numero, veio %T (%v)", v, v)
	}
	return int(f)
}

func erroDe(body map[string]any) string {
	s, _ := body["error"].(string)
	return s
}

// ----------------------------------------------------------------- partidas

func TestPontosSomamNaRodada(t *testing.T) {
	exigeRodadaAberta(t)
	a := novoAmbiente(t, nil)

	ana := a.registra(t, "Ana")
	bia := a.registra(t, "Bia")

	a.pontua(t, ana, 40)
	a.pontua(t, ana, 60)
	a.pontua(t, bia, 70)

	st, body := a.chama(t, nil, "GET", "/v1/rankings/players", nil)
	if st != 200 {
		t.Fatalf("ranking: status %d (%v)", st, body)
	}

	linhas, _ := body["rows"].([]any)
	if len(linhas) != 2 {
		t.Fatalf("esperava 2 jogadores no ranking, vieram %d", len(linhas))
	}

	primeira, _ := linhas[0].(map[string]any)
	if primeira["name"] != "Ana" {
		t.Errorf("primeiro lugar e %v, esperava Ana", primeira["name"])
	}
	if got := num(t, primeira["total"]); got != 100 {
		t.Errorf("total da Ana: %d, esperava 100 (40+60)", got)
	}
	if got := num(t, primeira["best"]); got != 60 {
		t.Errorf("melhor voo da Ana: %d, esperava 60", got)
	}

	// E a posicao de quem nao esta no topo.
	st, body = a.chama(t, &bia, "GET", "/v1/me/standing", nil)
	if st != 200 {
		t.Fatalf("standing: status %d (%v)", st, body)
	}
	pos, _ := body["standing"].(map[string]any)
	if got := num(t, pos["rank"]); got != 2 {
		t.Errorf("posicao da Bia: %d, esperava 2", got)
	}
}

func TestPlacarSoltoNaoEntraMais(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	// A rota antiga aceitava qualquer numero mandado pelo app. Ela nao existe
	// mais: ponto so entra fechando uma partida aberta no servidor.
	st, _ := a.chama(t, &ana, "POST", "/v1/runs", map[string]any{"points": 100})
	if st != http.StatusNotFound && st != http.StatusMethodNotAllowed {
		t.Errorf("rota de placar solto: status %d, esperava que nao existisse", st)
	}
}

func TestPlacarAcimaDoTetoERecusado(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	id, _ := a.abrePartida(t, ana)
	st, body := a.fechaPartida(t, ana, id, 999999, nil)
	if st != http.StatusUnprocessableEntity {
		t.Errorf("placar de 999999: status %d (%v), esperava 422", st, body)
	}
}

// ---------------------------------------------------------------- identidade

func TestSegredoErradoNaoJogaNoNomeDosOutros(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	// O codigo e publico — o jogador manda para os amigos. Sem o segredo, ele
	// nao serve para nada: nem para abrir partida, nem para gastar moeda.
	impostor := jogador{id: ana.id, secret: newUUID(), nome: "Ana"}
	st, body := a.chama(t, &impostor, "POST", "/v1/runs/start", nil)
	if st != 401 {
		t.Errorf("abrir partida com segredo errado: status %d (%v), esperava 401", st, body)
	}
	st, body = a.chama(t, &impostor, "POST", "/v1/shop/buy", map[string]any{"item": "shield"})
	if st != 401 {
		t.Errorf("comprar com segredo errado: status %d (%v), esperava 401", st, body)
	}

	// Nem para tomar o apelido.
	st, body = a.chama(t, nil, "POST", "/v1/players", map[string]any{
		"id": ana.id, "secret": newUUID(), "name": "Nao Ana",
	})
	if st != 401 {
		t.Errorf("registrar por cima: status %d (%v), esperava 401", st, body)
	}
}

func TestNomeELimpoPeloServidor(t *testing.T) {
	a := novoAmbiente(t, nil)

	j := jogador{id: newUUID(), secret: newUUID()}
	st, body := a.chama(t, nil, "POST", "/v1/players", map[string]any{
		"id": j.id, "secret": j.secret, "name": "   Piloto\tcom   nome    exageradamente longo  ",
	})
	if st != 200 {
		t.Fatalf("registrar: status %d (%v)", st, body)
	}

	p, _ := body["player"].(map[string]any)
	nome, _ := p["name"].(string)
	if len([]rune(nome)) > PlayerNameMax {
		t.Errorf("nome com %d letras, o teto e %d", len([]rune(nome)), PlayerNameMax)
	}
	if strings.Contains(nome, "  ") || strings.HasPrefix(nome, " ") {
		t.Errorf("nome mal limpo: %q", nome)
	}

	// Nome curto demais nao passa.
	st, _ = a.chama(t, nil, "POST", "/v1/players", map[string]any{
		"id": newUUID(), "secret": newUUID(), "name": " a ",
	})
	if st != 400 {
		t.Errorf("nome de uma letra: status %d, esperava 400", st)
	}
}

// -------------------------------------------------------------------- grupos

func TestGrupoDoConviteAoRanking(t *testing.T) {
	exigeRodadaAberta(t)
	a := novoAmbiente(t, nil)

	ana := a.registra(t, "Ana")
	bia := a.registra(t, "Bia")
	caio := a.registra(t, "Caio")

	// Sem grupo ainda.
	st, body := a.chama(t, &ana, "GET", "/v1/groups/me", nil)
	if st != 200 || body["group"] != nil {
		t.Fatalf("antes de criar: status %d, grupo %v", st, body["group"])
	}

	st, body = a.chama(t, &ana, "POST", "/v1/groups", map[string]any{"name": "Esquadrão"})
	if st != 200 {
		t.Fatalf("criar grupo: status %d (%v)", st, body)
	}

	// Quem nao e do grupo nao chama ninguem.
	st, body = a.chama(t, &bia, "POST", "/v1/groups/members", map[string]any{"playerId": caio.id})
	if st != 409 {
		t.Errorf("convite de quem nao tem grupo: status %d (%v), esperava 409", st, body)
	}

	// O lider chama.
	st, body = a.chama(t, &ana, "POST", "/v1/groups/members", map[string]any{"playerId": bia.id})
	if st != 200 || body["added"] != "Bia" {
		t.Fatalf("convite da Bia: status %d (%v)", st, body)
	}

	// Membro comum nao chama.
	st, body = a.chama(t, &bia, "POST", "/v1/groups/members", map[string]any{"playerId": caio.id})
	if st != 403 {
		t.Errorf("convite de membro comum: status %d (%v), esperava 403", st, body)
	}

	// Codigo que nao existe.
	st, body = a.chama(t, &ana, "POST", "/v1/groups/members", map[string]any{"playerId": newUUID()})
	if st != 404 {
		t.Errorf("codigo inexistente: status %d (%v), esperava 404", st, body)
	}

	// Dois grupos ao mesmo tempo, nao.
	st, body = a.chama(t, &bia, "POST", "/v1/groups", map[string]any{"name": "Outro"})
	if st != 409 {
		t.Errorf("segundo grupo na mesma rodada: status %d (%v), esperava 409", st, body)
	}

	// O placar do grupo e a soma dos dois.
	a.pontua(t, ana, 30)
	a.pontua(t, bia, 12)

	st, body = a.chama(t, &bia, "GET", "/v1/groups/me", nil)
	if st != 200 {
		t.Fatalf("meu grupo: status %d (%v)", st, body)
	}
	g, _ := body["group"].(map[string]any)
	if got := num(t, g["total"]); got != 42 {
		t.Errorf("total do grupo: %d, esperava 42 (30+12)", got)
	}
	if g["leaderId"] != ana.id {
		t.Errorf("lider %v, esperava a Ana", g["leaderId"])
	}

	membros, _ := g["members"].([]any)
	if len(membros) != 2 {
		t.Fatalf("esperava 2 membros, vieram %d", len(membros))
	}
	primeiro, _ := membros[0].(map[string]any)
	if primeiro["name"] != "Ana" || primeiro["leader"] != true {
		t.Errorf("primeiro membro: %v (a coroa deveria estar na Ana, que pontuou mais)", primeiro)
	}

	// E o ranking de grupos mostra o mesmo numero.
	st, body = a.chama(t, nil, "GET", "/v1/rankings/groups", nil)
	if st != 200 {
		t.Fatalf("ranking de grupos: status %d (%v)", st, body)
	}
	linhas, _ := body["rows"].([]any)
	if len(linhas) != 1 {
		t.Fatalf("esperava 1 grupo, vieram %d", len(linhas))
	}
	linha, _ := linhas[0].(map[string]any)
	if got := num(t, linha["total"]); got != 42 {
		t.Errorf("total no ranking: %d, esperava 42", got)
	}
	if got := num(t, linha["members"]); got != 2 {
		t.Errorf("membros no ranking: %d, esperava 2", got)
	}
	if linha["leader"] != "Ana" {
		t.Errorf("lider no ranking: %v, esperava Ana", linha["leader"])
	}
}

func TestCoroaPassaQuandoOLiderSai(t *testing.T) {
	exigeRodadaAberta(t)
	a := novoAmbiente(t, nil)

	ana := a.registra(t, "Ana")
	bia := a.registra(t, "Bia")

	if st, body := a.chama(t, &ana, "POST", "/v1/groups", map[string]any{"name": "Esquadrão"}); st != 200 {
		t.Fatalf("criar grupo: status %d (%v)", st, body)
	}
	if st, body := a.chama(t, &ana, "POST", "/v1/groups/members", map[string]any{"playerId": bia.id}); st != 200 {
		t.Fatalf("convite: status %d (%v)", st, body)
	}

	if st, body := a.chama(t, &ana, "DELETE", "/v1/groups/me", nil); st != 200 {
		t.Fatalf("sair: status %d (%v)", st, body)
	}

	st, body := a.chama(t, &bia, "GET", "/v1/groups/me", nil)
	if st != 200 {
		t.Fatalf("grupo da Bia: status %d (%v)", st, body)
	}
	g, _ := body["group"].(map[string]any)
	if g == nil {
		t.Fatal("o grupo sumiu junto com o lider; a coroa deveria ter passado para a Bia")
	}
	if g["leaderId"] != bia.id {
		t.Errorf("lider %v, esperava a Bia", g["leaderId"])
	}

	// Quem saiu ficou sem grupo — e pode criar outro.
	st, body = a.chama(t, &ana, "GET", "/v1/groups/me", nil)
	if st != 200 || body["group"] != nil {
		t.Errorf("Ana depois de sair: status %d, grupo %v", st, body["group"])
	}
	if st, body := a.chama(t, &ana, "POST", "/v1/groups", map[string]any{"name": "Outro"}); st != 200 {
		t.Errorf("criar grupo novo: status %d (%v)", st, body)
	}

	// Ultimo a sair apaga a luz: o grupo se desfaz e some do ranking.
	if st, _ := a.chama(t, &bia, "DELETE", "/v1/groups/me", nil); st != 200 {
		t.Fatal("Bia nao conseguiu sair")
	}
	_, body = a.chama(t, nil, "GET", "/v1/rankings/groups", nil)
	linhas, _ := body["rows"].([]any)
	if len(linhas) != 1 {
		t.Errorf("esperava so o grupo novo da Ana no ranking, vieram %d", len(linhas))
	}
}

func TestGrupoNaoPassaDeOitoJogadores(t *testing.T) {
	exigeRodadaAberta(t)
	a := novoAmbiente(t, nil)

	lider := a.registra(t, "Lider")
	if st, body := a.chama(t, &lider, "POST", "/v1/groups", map[string]any{"name": "Cheio"}); st != 200 {
		t.Fatalf("criar grupo: status %d (%v)", st, body)
	}

	// O lider ja conta, entao cabem mais sete.
	for i := 1; i < GroupMaxMembers; i++ {
		outro := a.registra(t, "Piloto "+string(rune('A'+i)))
		if st, body := a.chama(t, &lider, "POST", "/v1/groups/members", map[string]any{"playerId": outro.id}); st != 200 {
			t.Fatalf("convite %d: status %d (%v)", i, st, body)
		}
	}

	sobra := a.registra(t, "Sobra")
	st, body := a.chama(t, &lider, "POST", "/v1/groups/members", map[string]any{"playerId": sobra.id})
	if st != 409 {
		t.Fatalf("nono jogador: status %d (%v), esperava 409", st, body)
	}
	if !strings.Contains(erroDe(body), "8") {
		t.Errorf("mensagem %q deveria dizer o limite", erroDe(body))
	}
}

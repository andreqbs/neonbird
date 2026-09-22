package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// A economia contra um Postgres de verdade (pula sem TEST_DATABASE_URL).
//
// Cada teste e uma tentativa de ganhar alguma coisa sem ter direito: moeda que
// nao existia, placar feito rapido demais, nova chance repetida, premio de
// anuncio sem o aviso do Google. O jogo honesto aparece junto, porque o teste
// so vale se o caminho certo continuar funcionando.

// --------------------------------------------------------------- utilidades

func (a *ambiente) abrePartida(t *testing.T, quem jogador) (string, uint32) {
	t.Helper()
	st, body := a.chama(t, &quem, "POST", "/v1/runs/start", nil)
	if st != http.StatusOK {
		t.Fatalf("%s abrir partida: status %d (%v)", quem.nome, st, body)
	}
	run, _ := body["run"].(map[string]any)
	id, _ := run["id"].(string)
	return id, uint32(num(t, run["seed"]))
}

func (a *ambiente) fechaPartida(t *testing.T, quem jogador, id string, pontos int, moedas []int) (int, map[string]any) {
	t.Helper()
	return a.chama(t, &quem, "POST", "/v1/runs/"+id+"/finish", map[string]any{
		"points":       pontos,
		"coinOrdinals": moedas,
	})
}

// daMoedas poe saldo direto no banco — atalho de teste para nao precisar
// jogar cem partidas antes de testar a loja.
func (a *ambiente) daMoedas(t *testing.T, quem jogador, moedas int) {
	t.Helper()
	ctx := context.Background()
	if err := ensureWallet(ctx, a.store.pool, quem.id); err != nil {
		t.Fatalf("carteira: %v", err)
	}
	if _, err := a.store.pool.Exec(ctx,
		`update wallets set coins = $2 where player_id = $1`, quem.id, moedas); err != nil {
		t.Fatalf("dar moedas: %v", err)
	}
}

// daPassaro poe o passaro na conta e ja o escolhe — atalho para testar o poder
// dele sem juntar moedas e passar pela loja.
func (a *ambiente) daPassaro(t *testing.T, quem jogador, birdID string) {
	t.Helper()
	ctx := context.Background()
	if err := ensureWallet(ctx, a.store.pool, quem.id); err != nil {
		t.Fatalf("carteira: %v", err)
	}
	if birdID != DefaultBird {
		if _, err := a.store.pool.Exec(ctx,
			`insert into owned_birds (player_id, bird_id) values ($1, $2) on conflict do nothing`,
			quem.id, birdID); err != nil {
			t.Fatalf("dar passaro: %v", err)
		}
	}
	if _, err := a.store.pool.Exec(ctx,
		`update wallets set equipped_bird = $2 where player_id = $1`, quem.id, birdID); err != nil {
		t.Fatalf("escolher passaro: %v", err)
	}
}

func carteira(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	w, ok := body["wallet"].(map[string]any)
	if !ok {
		t.Fatalf("resposta sem carteira: %v", body)
	}
	return w
}

func codigoDe(body map[string]any) string {
	s, _ := body["code"].(string)
	return s
}

// moedasDe lista os obstaculos de 1..ate que tem moeda nesta semente.
func moedasDe(seed uint32, ate int) []int {
	var lista []int
	for o := 1; o <= ate; o++ {
		if HasCoin(seed, o, CoinEvery) {
			lista = append(lista, o)
		}
	}
	return lista
}

// ---------------------------------------------------------------- carteira

func TestCarteiraNovaComecaComCincoVidas(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	st, body := a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if st != http.StatusOK {
		t.Fatalf("carteira: status %d (%v)", st, body)
	}
	w := carteira(t, body)
	if num(t, w["lives"]) != MaxLives || num(t, w["coins"]) != 0 {
		t.Errorf("carteira nova: %v", w)
	}
	if w["equippedBird"] != DefaultBird {
		t.Errorf("passaro inicial %v, esperava %s", w["equippedBird"], DefaultBird)
	}
	donos, _ := w["ownedBirds"].([]any)
	if len(donos) != 1 || donos[0] != DefaultBird {
		t.Errorf("passaros iniciais: %v", donos)
	}
}

func TestCatalogoTrazOsPoderes(t *testing.T) {
	a := novoAmbiente(t, nil)
	st, body := a.chama(t, nil, "GET", "/v1/catalog", nil)
	if st != http.StatusOK {
		t.Fatalf("catalogo: status %d", st)
	}

	// Os poderes que o app sabe executar (src/game/powers.js).
	conhecidos := map[string]bool{
		PowerIDMagnet: true, PowerIDGhost: true, PowerIDSlow: true,
		PowerIDExtraChance: true, PowerIDCoinMultiplier: true,
	}
	passaros, _ := body["birds"].([]any)
	if len(passaros) != 6 {
		t.Fatalf("esperava o de sempre + 5 da loja, vieram %d", len(passaros))
	}
	for _, p := range passaros {
		b, _ := p.(map[string]any)
		poderes, ok := b["powers"].([]any)
		if !ok {
			t.Errorf("%v: os poderes vem como lista, veio %T", b["id"], b["powers"])
			continue
		}
		if b["id"] == DefaultBird {
			if len(poderes) != 0 || num(t, b["price"]) != 0 {
				t.Errorf("o passaro de sempre e de graca e sem poder: %v", b)
			}
			continue
		}
		// Da para comprar com moedas, com dinheiro (productId) ou dos dois jeitos.
		if len(poderes) == 0 || (num(t, b["price"]) <= 0 && b["productId"] == nil) {
			t.Errorf("passaro da loja precisa de um jeito de comprar e de poder: %v", b)
		}
		for _, x := range poderes {
			pw, _ := x.(map[string]any)
			id, _ := pw["id"].(string)
			if !conhecidos[id] {
				t.Errorf("%v tem um poder que o app nao conhece: %q", b["id"], id)
			}
			if pw["name"] == "" || pw["description"] == "" {
				t.Errorf("poder sem nome ou sem frase para a loja: %v", pw)
			}
		}
	}
}

// Quem ajusta um poder mexe so no numero (catalog.go): a frase da loja tem que
// acompanhar sozinha, com virgula decimal.
func TestFraseDoPoderAcompanhaOsNumeros(t *testing.T) {
	casos := []struct {
		poder Power
		tem   []string
	}{
		{magnetPower(6, 12, 5), []string{"6 s ligado", "12 s recarregando"}},
		{ghostPower(2.5, 10), []string{"2,5 s invisível"}},
		{slowPower(1.5, 8, 25), []string{"25% mais devagar", "1,5 s", "8 s"}},
		{extraChancePower(2, false), []string{"2 novas chances"}},
		{coinMultiplierPower(3), []string{"3 vezes"}},
	}
	for _, c := range casos {
		for _, trecho := range c.tem {
			if !strings.Contains(c.poder.Description, trecho) {
				t.Errorf("%s: a frase %q deveria ter %q", c.poder.ID, c.poder.Description, trecho)
			}
		}
	}
	if extraChancePower(1, true).Params["videoOnly"] != 1 || coinMultiplierPower(3).Params["multiplier"] != 3 {
		t.Error("os numeros do poder tem que ir para o app nos params")
	}
}

// ---------------------------------------------------------------- partidas

func TestAbrirPartidaGastaVidaAteAcabar(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	primeira, _ := a.abrePartida(t, ana)
	for i := 1; i < MaxLives; i++ {
		a.abrePartida(t, ana)
	}

	st, body := a.chama(t, &ana, "POST", "/v1/runs/start", nil)
	if st != http.StatusConflict || codigoDe(body) != "no_lives" {
		t.Fatalf("sexta partida sem vida: status %d (%v), esperava 409 no_lives", st, body)
	}

	// Abrir outra partida abandona a anterior: nao da para abrir varias e
	// fechar so a melhor.
	st, body = a.fechaPartida(t, ana, primeira, 10, nil)
	if st != http.StatusConflict || codigoDe(body) != "run_closed" {
		t.Errorf("fechar partida abandonada: status %d (%v), esperava 409 run_closed", st, body)
	}
}

func TestSoContaMoedaQueExistia(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	id, seed := a.abrePartida(t, ana)
	boas := moedasDe(seed, 30)
	if len(boas) == 0 {
		t.Skip("semente sem moeda nos 30 primeiros obstaculos (raro)")
	}

	semMoeda := 0
	for o := 1; o <= 30; o++ {
		if !HasCoin(seed, o, CoinEvery) {
			semMoeda = o
			break
		}
	}

	// As verdadeiras, mais: a primeira letra inteira e mais um tanto alem do
	// tamanho dela, uma de obstaculo sem moeda, e uma muito alem de onde o
	// jogador chegou.
	lista := append([]int{}, boas...)
	for i := 0; i < 20; i++ {
		lista = append(lista, boas[0])
	}
	lista = append(lista, semMoeda)
	for o := 60; o < 200; o++ {
		if HasCoin(seed, o, CoinEvery) {
			lista = append(lista, o)
			break
		}
	}

	st, body := a.fechaPartida(t, ana, id, 30, lista)
	if st != http.StatusOK {
		t.Fatalf("fechar partida: status %d (%v)", st, body)
	}
	// Uma moeda de cada letra, e a primeira letra inteira — nem uma a mais.
	quer := len(boas) - 1 + letterCoins[CoinLetterAt(seed, boas[0], CoinEvery)]
	res, _ := body["result"].(map[string]any)
	if got := num(t, res["coins"]); got != quer {
		t.Errorf("moedas creditadas: %d, esperava %d (so as que existiam)", got, quer)
	}
	if got := num(t, carteira(t, body)["coins"]); got != quer {
		t.Errorf("saldo: %d, esperava %d", got, quer)
	}
}

// O app repete o fechamento quando a resposta se perde no caminho: o servidor
// gravou, a conexao caiu antes de o aparelho ouvir. A repeticao devolve o que ja
// estava gravado — nem moeda nem ponto em dobro, e placar novo nao entra.
func TestFecharDeNovoDevolveOMesmoResultado(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	id, seed := a.abrePartida(t, ana)
	st, body := a.fechaPartida(t, ana, id, 120, moedasDe(seed, 120))
	if st != http.StatusOK {
		t.Fatalf("fechar: status %d (%v)", st, body)
	}
	primeiro, _ := body["result"].(map[string]any)
	saldo := num(t, carteira(t, body)["coins"])

	// A repeticao chega com outro placar, como mandaria um app adulterado.
	st, body = a.fechaPartida(t, ana, id, 500, moedasDe(seed, 500))
	if st != http.StatusOK {
		t.Fatalf("fechar de novo: status %d (%v), esperava 200 com o mesmo resultado", st, body)
	}
	segundo, _ := body["result"].(map[string]any)
	for _, campo := range []string{"points", "coins", "stageBonus"} {
		if num(t, segundo[campo]) != num(t, primeiro[campo]) {
			t.Errorf("%s mudou na repeticao: %v -> %v", campo, primeiro[campo], segundo[campo])
		}
	}
	if segundo["ranked"] != primeiro["ranked"] {
		t.Errorf("ranked mudou na repeticao: %v -> %v", primeiro["ranked"], segundo["ranked"])
	}
	if got := num(t, carteira(t, body)["coins"]); got != saldo {
		t.Errorf("fechar de novo pagou de novo: saldo %d, esperava %d", got, saldo)
	}

	if CurrentSeason().Open {
		_, body = a.chama(t, &ana, "GET", "/v1/me/standing", nil)
		posicao, _ := body["standing"].(map[string]any)
		if got := num(t, posicao["total"]); got != 120 {
			t.Errorf("pontos na rodada: %d, esperava 120 (a partida conta uma vez)", got)
		}
	}
}

// envelhecePartida empurra a abertura da partida `segundos` para o passado —
// atalho para testar o que depende do relogio sem esperar de verdade.
func (a *ambiente) envelhecePartida(t *testing.T, id string, segundos float64) {
	t.Helper()
	if _, err := a.store.pool.Exec(context.Background(),
		`update game_sessions set started_at = started_at - make_interval(secs => $2) where id = $1`,
		id, segundos); err != nil {
		t.Fatalf("envelhecer partida: %v", err)
	}
}

// Tempo de voo: o app mede so o tempo voando de fato e manda ao fechar a
// partida; o servidor soma na carteira. Nao vale moeda, entao a conferencia e so
// contra o absurdo: voo maior que o tempo desde a abertura vira esse tempo.
func TestTempoDeVooSomaNaCarteira(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	fecha := func(id string, voo int64) map[string]any {
		t.Helper()
		st, body := a.chama(t, &ana, "POST", "/v1/runs/"+id+"/finish", map[string]any{
			"points": 5, "coinOrdinals": []int{}, "flightMs": voo,
		})
		if st != http.StatusOK {
			t.Fatalf("fechar com tempo de voo: status %d (%v)", st, body)
		}
		return body
	}

	// Partida aberta ha 5 minutos, com 42 s de voo.
	id, _ := a.abrePartida(t, ana)
	a.envelhecePartida(t, id, 300)
	body := fecha(id, 42_000)
	res, _ := body["result"].(map[string]any)
	if got := num(t, res["flightMs"]); got != 42_000 {
		t.Errorf("voo da partida: %d ms, esperava 42000", got)
	}
	if got := num(t, carteira(t, body)["flightMs"]); got != 42_000 {
		t.Errorf("voo na carteira: %d ms, esperava 42000", got)
	}

	// Voo impossivel: 10 horas numa partida aberta ha 2 minutos.
	outra, _ := a.abrePartida(t, ana)
	a.envelhecePartida(t, outra, 120)
	body = fecha(outra, 36_000_000)
	res, _ = body["result"].(map[string]any)
	voo := num(t, res["flightMs"])
	if voo < 119_000 || voo > 125_000 {
		t.Errorf("voo impossivel virou %d ms, esperava ~120000 (o tempo desde a abertura)", voo)
	}
	total := num(t, carteira(t, body)["flightMs"])
	if total != 42_000+voo {
		t.Errorf("voo somado: %d ms, esperava %d", total, 42_000+voo)
	}

	// Fechar de novo devolve o mesmo voo e nao soma outra vez.
	body = fecha(outra, 36_000_000)
	res, _ = body["result"].(map[string]any)
	if got := num(t, res["flightMs"]); got != voo {
		t.Errorf("a repeticao mudou o voo da partida: %d ms, esperava %d", got, voo)
	}
	if got := num(t, carteira(t, body)["flightMs"]); got != total {
		t.Errorf("fechar de novo somou o voo outra vez: %d ms, esperava %d", got, total)
	}
}

func TestFecharFaseRendeBonus(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	id, _ := a.abrePartida(t, ana)
	st, body := a.fechaPartida(t, ana, id, 250, nil)
	if st != http.StatusOK {
		t.Fatalf("fechar: status %d (%v)", st, body)
	}
	res, _ := body["result"].(map[string]any)
	if got := num(t, res["stageBonus"]); got != 2*StageBonus {
		t.Errorf("bonus por 250 pontos: %d, esperava %d (duas fases fechadas)", got, 2*StageBonus)
	}
}

func TestPlacarRapidoDemaisNaoRendeNada(t *testing.T) {
	a := novoAmbiente(t, func(c *Config) { c.MinSecondsPerPoint = 1 })
	ana := a.registra(t, "Ana")

	id, seed := a.abrePartida(t, ana)
	st, body := a.fechaPartida(t, ana, id, 80, moedasDe(seed, 80))
	if st != http.StatusUnprocessableEntity || codigoDe(body) != "run_rejected" {
		t.Fatalf("80 pontos em milissegundos: status %d (%v), esperava 422 run_rejected", st, body)
	}

	// Insistir nao muda nada: a partida continua recusada.
	st, body = a.fechaPartida(t, ana, id, 80, moedasDe(seed, 80))
	if st != http.StatusUnprocessableEntity || codigoDe(body) != "run_rejected" {
		t.Errorf("repetir a partida recusada: status %d (%v), esperava 422 run_rejected", st, body)
	}

	_, body = a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if got := num(t, carteira(t, body)["coins"]); got != 0 {
		t.Errorf("partida recusada rendeu %d moedas", got)
	}
	st, _ = a.chama(t, nil, "GET", "/v1/rankings/players", nil)
	if st != http.StatusOK {
		t.Fatalf("ranking: status %d", st)
	}
}

// ------------------------------------------------------------------ poderes

// Cometa: as moedas pegas no voo valem o dobro. O bonus de fase fechada, nao.
func TestCometaDobraAsMoedasDoVoo(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daPassaro(t, ana, "comet")

	id, seed := a.abrePartida(t, ana)
	moedas := moedasDe(seed, 250)
	st, body := a.fechaPartida(t, ana, id, 250, moedas)
	if st != http.StatusOK {
		t.Fatalf("fechar: status %d (%v)", st, body)
	}
	res, _ := body["result"].(map[string]any)
	if got := num(t, res["coins"]); got != 2*len(moedas) {
		t.Errorf("moedas do voo: %d, esperava %d (o dobro de %d)", got, 2*len(moedas), len(moedas))
	}
	if got := num(t, res["coinMultiplier"]); got != 2 {
		t.Errorf("multiplicador: %d, esperava 2", got)
	}
	if got := num(t, res["stageBonus"]); got != 2*StageBonus {
		t.Errorf("bonus de fase: %d, esperava %d (nao dobra)", got, 2*StageBonus)
	}
	saldo := num(t, carteira(t, body)["coins"])
	if saldo != 2*len(moedas)+2*StageBonus {
		t.Errorf("saldo: %d, esperava %d", saldo, 2*len(moedas)+2*StageBonus)
	}

	// Fechar de novo devolve o mesmo resultado — sem dobrar outra vez.
	st, body = a.fechaPartida(t, ana, id, 250, moedas)
	if st != http.StatusOK || num(t, carteira(t, body)["coins"]) != saldo {
		t.Errorf("repeticao: status %d, saldo %v (esperava %d)", st, carteira(t, body)["coins"], saldo)
	}
	res, _ = body["result"].(map[string]any)
	if num(t, res["coinMultiplier"]) != 2 {
		t.Errorf("a repeticao perdeu o multiplicador: %v", res)
	}
}

// Brasa: duas novas chances por partida no lugar de uma.
func TestBrasaTemDuasNovasChances(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daMoedas(t, ana, 1000)
	a.daPassaro(t, ana, "ember")

	st, body := a.chama(t, &ana, "POST", "/v1/runs/start", nil)
	if st != http.StatusOK {
		t.Fatalf("abrir: status %d (%v)", st, body)
	}
	run, _ := body["run"].(map[string]any)
	if got := num(t, run["maxContinues"]); got != 2 {
		t.Errorf("novas chances da Brasa: %d, esperava 2", got)
	}
	if run["bird"] != "ember" {
		t.Errorf("a partida deveria saber o passaro: %v", run["bird"])
	}
	id, _ := run["id"].(string)

	for i := 1; i <= 2; i++ {
		if st, body := a.chama(t, &ana, "POST", "/v1/runs/"+id+"/continue", map[string]any{"method": "coins"}); st != http.StatusOK {
			t.Fatalf("nova chance %d: status %d (%v)", i, st, body)
		}
	}
	st, body = a.chama(t, &ana, "POST", "/v1/runs/"+id+"/continue", map[string]any{"method": "coins"})
	if st != http.StatusConflict || codigoDe(body) != "continue_limit" {
		t.Errorf("terceira nova chance: status %d (%v), esperava 409 continue_limit", st, body)
	}
}

// O poder e do passaro da ABERTURA da partida: trocar de passaro no meio nao
// muda o que ela rende — nem para mais, nem para menos.
func TestPoderValeDoPassaroDaAbertura(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daPassaro(t, ana, "comet")

	id, seed := a.abrePartida(t, ana)
	if st, body := a.chama(t, &ana, "POST", "/v1/me/bird", map[string]any{"birdId": DefaultBird}); st != http.StatusOK {
		t.Fatalf("trocar para o de sempre: status %d (%v)", st, body)
	}
	moedas := moedasDe(seed, 60)
	_, body := a.fechaPartida(t, ana, id, 60, moedas)
	res, _ := body["result"].(map[string]any)
	if got := num(t, res["coins"]); got != 2*len(moedas) {
		t.Errorf("aberta com o Cometa: %d moedas, esperava %d", got, 2*len(moedas))
	}

	// Aberta com o de sempre, trocar para o Cometa no meio nao dobra nada.
	id, seed = a.abrePartida(t, ana)
	if st, body := a.chama(t, &ana, "POST", "/v1/me/bird", map[string]any{"birdId": "comet"}); st != http.StatusOK {
		t.Fatalf("trocar para o Cometa: status %d (%v)", st, body)
	}
	moedas = moedasDe(seed, 60)
	_, body = a.fechaPartida(t, ana, id, 60, moedas)
	res, _ = body["result"].(map[string]any)
	if got := num(t, res["coins"]); got != len(moedas) {
		t.Errorf("aberta com o de sempre: %d moedas, esperava %d", got, len(moedas))
	}
	if got := num(t, res["coinMultiplier"]); got != 1 {
		t.Errorf("multiplicador do de sempre: %d, esperava 1", got)
	}
}

func TestNovaChanceUmaVezPorPartida(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daMoedas(t, ana, 250)

	id, _ := a.abrePartida(t, ana)

	st, body := a.chama(t, &ana, "POST", "/v1/runs/"+id+"/continue", map[string]any{"method": "stock"})
	if st != http.StatusConflict || codigoDe(body) != "no_stock" {
		t.Errorf("nova chance sem estoque: status %d (%v)", st, body)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/runs/"+id+"/continue", map[string]any{"method": "coins"})
	if st != http.StatusOK {
		t.Fatalf("nova chance paga: status %d (%v)", st, body)
	}
	if got := num(t, carteira(t, body)["coins"]); got != 250-ContinuePrice {
		t.Errorf("saldo depois da nova chance: %d, esperava %d", got, 250-ContinuePrice)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/runs/"+id+"/continue", map[string]any{"method": "coins"})
	if st != http.StatusConflict || codigoDe(body) != "continue_limit" {
		t.Errorf("segunda nova chance na mesma partida: status %d (%v)", st, body)
	}

	// Comprada na loja, fica guardada e serve na partida seguinte.
	st, body = a.chama(t, &ana, "POST", "/v1/shop/buy", map[string]any{"item": "continue"})
	if st != http.StatusOK || num(t, carteira(t, body)["continues"]) != 1 {
		t.Fatalf("comprar nova chance: status %d (%v)", st, body)
	}
	outra, _ := a.abrePartida(t, ana)
	st, body = a.chama(t, &ana, "POST", "/v1/runs/"+outra+"/continue", map[string]any{"method": "stock"})
	if st != http.StatusOK || num(t, carteira(t, body)["continues"]) != 0 {
		t.Errorf("usar nova chance guardada: status %d (%v)", st, body)
	}
}

func TestEscudoSoComEstoque(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	id, _ := a.abrePartida(t, ana)

	st, body := a.chama(t, &ana, "POST", "/v1/runs/"+id+"/shield", nil)
	if st != http.StatusConflict || codigoDe(body) != "no_stock" {
		t.Errorf("escudo sem estoque: status %d (%v)", st, body)
	}

	a.daMoedas(t, ana, ShieldPrice)
	st, body = a.chama(t, &ana, "POST", "/v1/shop/buy", map[string]any{"item": "shield"})
	if st != http.StatusOK || num(t, carteira(t, body)["shields"]) != 1 || num(t, carteira(t, body)["coins"]) != 0 {
		t.Fatalf("comprar escudo: status %d (%v)", st, body)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/runs/"+id+"/shield", nil)
	if st != http.StatusOK || num(t, carteira(t, body)["shields"]) != 0 {
		t.Errorf("usar escudo guardado: status %d (%v)", st, body)
	}
}

// -------------------------------------------------------------------- loja

func TestLojaDePassaros(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	// Da para a Geada, e sobra uma moeda a menos do que a Brasa custa: o teste
	// vale com qualquer preco do catalogo (catalog.go).
	geada, _ := birdByID("frost")
	brasa, _ := birdByID("ember")
	a.daMoedas(t, ana, geada.Price+brasa.Price-1)

	st, body := a.chama(t, &ana, "POST", "/v1/shop/buy", map[string]any{"item": "bird", "birdId": "frost"})
	if st != http.StatusOK {
		t.Fatalf("comprar Geada: status %d (%v)", st, body)
	}
	w := carteira(t, body)
	if num(t, w["coins"]) != brasa.Price-1 {
		t.Errorf("saldo depois da compra: %v, esperava %d", w["coins"], brasa.Price-1)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/shop/buy", map[string]any{"item": "bird", "birdId": "frost"})
	if st != http.StatusConflict || codigoDe(body) != "already_owned" {
		t.Errorf("comprar o mesmo passaro de novo: status %d (%v)", st, body)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/shop/buy", map[string]any{"item": "bird", "birdId": "ember"})
	if st != http.StatusConflict || codigoDe(body) != "not_enough_coins" {
		t.Errorf("comprar sem saldo: status %d (%v)", st, body)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/shop/buy", map[string]any{"item": "bird", "birdId": DefaultBird})
	if st != http.StatusNotFound {
		t.Errorf("comprar o passaro de graca: status %d (%v)", st, body)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/me/bird", map[string]any{"birdId": "ember"})
	if st != http.StatusForbidden || codigoDe(body) != "not_owned" {
		t.Errorf("usar passaro nao comprado: status %d (%v)", st, body)
	}

	st, body = a.chama(t, &ana, "POST", "/v1/me/bird", map[string]any{"birdId": "frost"})
	if st != http.StatusOK || carteira(t, body)["equippedBird"] != "frost" {
		t.Errorf("usar passaro comprado: status %d (%v)", st, body)
	}
}

// ---------------------------------------------------------------- anuncios

func TestAnuncioSoPagaComAvisoDoGoogle(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	st, body := a.chama(t, &ana, "POST", "/v1/ads/claim", map[string]any{"kind": "lives"})
	if st != http.StatusConflict || codigoDe(body) != "lives_full" {
		t.Errorf("pedir vidas com o tanque cheio: status %d (%v)", st, body)
	}

	for i := 0; i < MaxLives; i++ {
		a.abrePartida(t, ana)
	}

	// O app diz que o video terminou, mas o Google ainda nao avisou nada.
	st, body = a.chama(t, &ana, "POST", "/v1/ads/claim", map[string]any{"kind": "lives"})
	if st != http.StatusAccepted {
		t.Fatalf("premio sem aviso do Google: status %d (%v), esperava 202 pendente", st, body)
	}

	// Um aviso com assinatura falsa nao vale.
	falso := assinaSSV(t, novaChave(t), a.keyID, ana.id, "tx-falso")
	if st, _ := a.chama(t, nil, "GET", "/v1/ads/ssv?"+falso, nil); st != http.StatusOK {
		t.Errorf("aviso falso deveria responder 200 (para o Google nao repetir), veio %d", st)
	}
	st, _ = a.chama(t, &ana, "POST", "/v1/ads/claim", map[string]any{"kind": "lives"})
	if st != http.StatusAccepted {
		t.Fatalf("aviso com assinatura falsa liberou premio: status %d", st)
	}

	// Agora o aviso de verdade — que o Google manda duas vezes.
	verdadeiro := assinaSSV(t, a.chave, a.keyID, ana.id, "tx-verdadeiro")
	for i := 0; i < 2; i++ {
		if st, body := a.chama(t, nil, "GET", "/v1/ads/ssv?"+verdadeiro, nil); st != http.StatusOK {
			t.Fatalf("aviso verdadeiro: status %d (%v)", st, body)
		}
	}

	st, body = a.chama(t, &ana, "POST", "/v1/ads/claim", map[string]any{"kind": "lives"})
	if st != http.StatusOK || num(t, carteira(t, body)["lives"]) != MaxLives {
		t.Fatalf("premio com aviso do Google: status %d (%v)", st, body)
	}

	// Um video, um premio: o aviso repetido nao virou dois.
	a.abrePartida(t, ana)
	st, _ = a.chama(t, &ana, "POST", "/v1/ads/claim", map[string]any{"kind": "shield"})
	if st != http.StatusAccepted {
		t.Errorf("o mesmo video pagou duas vezes: status %d", st)
	}
}

func TestAnuncioEmServidorDeDesenvolvimento(t *testing.T) {
	a := novoAmbiente(t, func(c *Config) { c.AdsDevAutoVerify = true })
	ana := a.registra(t, "Ana")

	st, body := a.chama(t, &ana, "POST", "/v1/ads/claim", map[string]any{"kind": "shield"})
	if st != http.StatusOK || num(t, carteira(t, body)["shields"]) != 1 {
		t.Fatalf("premio em servidor de desenvolvimento: status %d (%v)", st, body)
	}
}

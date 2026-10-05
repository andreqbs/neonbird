package main

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// O ranking geral, o de rodadas passadas e os premios de quem fechou a rodada
// no topo (prizes.go).

// pontosNaRodada poe pontos direto numa rodada — atalho para montar rodada
// passada sem esperar uma semana.
func (a *ambiente) pontosNaRodada(t *testing.T, quem jogador, rodada string, pontos int) {
	t.Helper()
	if _, err := a.store.pool.Exec(context.Background(),
		`insert into runs (player_id, season_id, points) values ($1, $2, $3)`, quem.id, rodada, pontos); err != nil {
		t.Fatalf("pontos: %v", err)
	}
}

func TestPremiosDaRodadaPagamUmaVezSo(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana, bia, caio, davi := a.registra(t, "Ana"), a.registra(t, "Bia"), a.registra(t, "Caio"), a.registra(t, "Davi")
	rodada, ok := seasonByID("2026-09-06")
	if !ok {
		t.Fatal("rodada de teste invalida")
	}
	a.pontosNaRodada(t, ana, rodada.ID, 50)
	a.pontosNaRodada(t, bia, rodada.ID, 90)
	a.pontosNaRodada(t, caio, rodada.ID, 70)
	a.pontosNaRodada(t, davi, rodada.ID, 10)
	premios := []int{4000, 2000, 500}

	// Rodada ainda aberta: ninguem ganha nada.
	if n, err := a.store.PaySeasonPrizes(context.Background(), rodada, premios, rodada.EndsAt.Add(-time.Minute)); err != nil || n != 0 {
		t.Fatalf("rodada aberta pagou %d (%v)", n, err)
	}
	depois := rodada.EndsAt.Add(time.Minute)
	if n, err := a.store.PaySeasonPrizes(context.Background(), rodada, premios, depois); err != nil || n != 3 {
		t.Fatalf("rodada fechada: %d premios (%v), esperava 3", n, err)
	}
	// De novo (outra instancia, o laco rodando outra vez): nada a mais.
	if n, _ := a.store.PaySeasonPrizes(context.Background(), rodada, premios, depois); n != 0 {
		t.Errorf("pagou %d premios de novo", n)
	}

	esperado := map[string]int{"Bia": 4000, "Caio": 2000, "Ana": 500, "Davi": 0}
	for _, j := range []jogador{ana, bia, caio, davi} {
		_, body := a.chama(t, &j, "GET", "/v1/me/wallet", nil)
		if got := num(t, carteira(t, body)["coins"]); got != esperado[j.nome] {
			t.Errorf("%s ficou com %d moedas, esperava %d", j.nome, got, esperado[j.nome])
		}
	}
}

func TestRankingGeralEDaRodadaPassada(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana, bia := a.registra(t, "Ana"), a.registra(t, "Bia")
	a.pontosNaRodada(t, ana, "2026-09-06", 100)
	a.pontosNaRodada(t, bia, "2026-09-13", 60)
	a.pontosNaRodada(t, bia, "2026-09-20", 60)

	// Geral: soma tudo, de todas as rodadas — a Bia passa a Ana.
	st, body := a.chama(t, nil, "GET", "/v1/rankings/players?scope=all", nil)
	linhas, _ := body["rows"].([]any)
	if st != http.StatusOK || len(linhas) != 2 {
		t.Fatalf("geral: status %d (%v)", st, body)
	}
	primeiro, _ := linhas[0].(map[string]any)
	if primeiro["name"] != "Bia" || num(t, primeiro["total"]) != 120 || primeiro["prize"] != nil {
		t.Errorf("geral: primeiro %v", primeiro)
	}

	// Uma rodada passada: so os pontos dela, e o premio de cada posicao.
	st, body = a.chama(t, nil, "GET", "/v1/rankings/players?season=2026-09-06", nil)
	linhas, _ = body["rows"].([]any)
	if st != http.StatusOK || len(linhas) != 1 {
		t.Fatalf("rodada passada: status %d (%v)", st, body)
	}
	primeiro, _ = linhas[0].(map[string]any)
	if primeiro["name"] != "Ana" || num(t, primeiro["prize"]) != SeasonPrizes[0] {
		t.Errorf("rodada passada: %v", primeiro)
	}

	// Data que nao e domingo, texto torto ou rodada que nem comecou: recusa.
	for _, ruim := range []string{"2026-09-07", "ontem", "2099-01-04"} {
		if st, _ := a.chama(t, nil, "GET", "/v1/rankings/players?season="+ruim, nil); st != http.StatusBadRequest {
			t.Errorf("rodada %q: status %d, esperava 400", ruim, st)
		}
	}
}

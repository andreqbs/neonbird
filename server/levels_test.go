package main

import (
	"net/http"
	"testing"
)

// As estrelas dos passaros: cada uma, comprada com moedas, estica o tempo do
// poder (catalog.go). O que vale e sempre a conta do servidor — o app so mostra
// as estrelas e manda o pedido.

// estrelas le quantas estrelas a carteira diz que o jogador tem num passaro.
func estrelas(t *testing.T, body map[string]any, passaro string) int {
	t.Helper()
	niveis, _ := carteira(t, body)["birdLevels"].(map[string]any)
	if niveis == nil || niveis[passaro] == nil {
		return 0
	}
	return num(t, niveis[passaro])
}

// tempoDoPoder le os segundos que o poder do passaro da partida vai ficar ligado.
func tempoDoPoder(t *testing.T, body map[string]any) float64 {
	t.Helper()
	run, _ := body["run"].(map[string]any)
	poderes, _ := run["powers"].([]any)
	if len(poderes) == 0 {
		t.Fatalf("a partida veio sem poder: %v", run)
	}
	p, _ := poderes[0].(map[string]any)
	params, _ := p["params"].(map[string]any)
	segundos, ok := params["activeSeconds"].(float64)
	if !ok {
		t.Fatalf("poder sem activeSeconds: %v", p)
	}
	return segundos
}

func TestCatalogoDizQuemEvolui(t *testing.T) {
	a := novoAmbiente(t, nil)
	st, body := a.chama(t, nil, "GET", "/v1/catalog", nil)
	if st != http.StatusOK {
		t.Fatalf("catalogo: status %d", st)
	}
	evolui := map[string]bool{"frost": true, "toxic": true, "phantom": true}

	passaros, _ := body["birds"].([]any)
	for _, x := range passaros {
		b, _ := x.(map[string]any)
		id, _ := b["id"].(string)
		poderes, _ := b["powers"].([]any)
		estrelasMax := num(t, b["maxStars"])

		if len(poderes) == 0 {
			if estrelasMax != 0 || b["upgradable"] == true {
				t.Errorf("%s nao tem poder, entao nao tem estrela: %v", id, b)
			}
			continue
		}
		if estrelasMax != MaxBirdLevel {
			t.Errorf("%s: %d estrelas no maximo, esperava %d", id, estrelasMax, MaxBirdLevel)
		}
		if b["upgradable"] != evolui[id] {
			t.Errorf("%s: evolui = %v, esperava %v", id, b["upgradable"], evolui[id])
		}

		precos, _ := b["upgradePrices"].([]any)
		if evolui[id] {
			if len(precos) != MaxBirdLevel {
				t.Errorf("%s: %d precos de estrela, esperava %d", id, len(precos), MaxBirdLevel)
				continue
			}
			for i, preco := range precos {
				if num(t, preco) != UpgradePrices[i] {
					t.Errorf("%s: estrela %d custa %v, esperava %d", id, i+1, preco, UpgradePrices[i])
				}
			}
			// O poder tem que dizer o que cresce, e a tabela inteira.
			p, _ := poderes[0].(map[string]any)
			valores, _ := p["levelValues"].([]any)
			if p["levelParam"] != "activeSeconds" || len(valores) != MaxBirdLevel+1 {
				t.Errorf("%s: poder sem a tabela dos niveis: %v", id, p)
			}
		} else if len(precos) != 0 {
			t.Errorf("%s nao evolui, entao nao tem preco de estrela: %v", id, precos)
		}
	}
}

func TestEstrelaEsticaOTempoDoPoder(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daPassaro(t, ana, "frost")
	a.daMoedas(t, ana, 1000)

	// Recem-comprado: nenhuma estrela, e o poder no tempo de sempre.
	st, body := a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if st != http.StatusOK || estrelas(t, body, "frost") != 0 {
		t.Fatalf("passaro novo comeca sem estrela: %v", carteira(t, body)["birdLevels"])
	}
	_, body = a.chama(t, &ana, "POST", "/v1/runs/start", nil)
	if got := tempoDoPoder(t, body); got != 2 {
		t.Errorf("camera lenta sem estrela: %v s, esperava 2", got)
	}

	// Duas estrelas: 10 + 20 moedas, e o poder vai a 3 s.
	for i := 1; i <= 2; i++ {
		st, body = a.chama(t, &ana, "POST", "/v1/shop/upgrade", map[string]any{"birdId": "frost"})
		if st != http.StatusOK || estrelas(t, body, "frost") != i {
			t.Fatalf("estrela %d: status %d (%v)", i, st, body)
		}
	}
	if got := num(t, carteira(t, body)["coins"]); got != 1000-UpgradePrices[0]-UpgradePrices[1] {
		t.Errorf("saldo depois de duas estrelas: %d", got)
	}
	_, body = a.chama(t, &ana, "POST", "/v1/runs/start", nil)
	if got := tempoDoPoder(t, body); got != 3 {
		t.Errorf("camera lenta com duas estrelas: %v s, esperava 3", got)
	}

	// Ate as cinco, e nao passa disso.
	for i := 3; i <= MaxBirdLevel; i++ {
		if st, body := a.chama(t, &ana, "POST", "/v1/shop/upgrade", map[string]any{"birdId": "frost"}); st != http.StatusOK {
			t.Fatalf("estrela %d: status %d (%v)", i, st, body)
		}
	}
	st, body = a.chama(t, &ana, "POST", "/v1/shop/upgrade", map[string]any{"birdId": "frost"})
	if st != http.StatusConflict || codigoDe(body) != "max_level" {
		t.Errorf("sexta estrela: status %d (%v), esperava 409 max_level", st, body)
	}
	_, body = a.chama(t, &ana, "POST", "/v1/runs/start", nil)
	if got := tempoDoPoder(t, body); got != 6 {
		t.Errorf("camera lenta com cinco estrelas: %v s, esperava 6", got)
	}
}

func TestOTempoDeCadaEstrela(t *testing.T) {
	casos := []struct {
		passaro string
		quer    []float64
	}{
		{"frost", []float64{2, 2.5, 3, 3.5, 4, 6}},
		{"phantom", []float64{2, 2.5, 3, 3.5, 4, 6}},
		{"toxic", []float64{4, 5, 6, 7, 7.5, 8}},
	}
	for _, c := range casos {
		b, _ := birdByID(c.passaro)
		for nivel, quer := range c.quer {
			poder := b.powersAtLevel(nivel)[0]
			if got := poder.Params["activeSeconds"]; got != quer {
				t.Errorf("%s com %d estrelas: %v s, esperava %v", c.passaro, nivel, got, quer)
			}
		}
	}
}

func TestBrasaECometaJaNascemNoMaximo(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daMoedas(t, ana, 1000)
	a.daPassaro(t, ana, "ember")

	st, body := a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if st != http.StatusOK || estrelas(t, body, "ember") != MaxBirdLevel {
		t.Errorf("a Brasa ja nasce com as cinco estrelas: %v", carteira(t, body)["birdLevels"])
	}
	st, body = a.chama(t, &ana, "POST", "/v1/shop/upgrade", map[string]any{"birdId": "ember"})
	if st != http.StatusConflict || codigoDe(body) != "not_upgradable" {
		t.Errorf("evoluir a Brasa: status %d (%v), esperava 409 not_upgradable", st, body)
	}
	_, body = a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if got := num(t, carteira(t, body)["coins"]); got != 1000 {
		t.Errorf("a recusa cobrou %d moedas", 1000-got)
	}
}

func TestSoEvoluiPassaroQueOJogadorTem(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daMoedas(t, ana, 1000)

	st, body := a.chama(t, &ana, "POST", "/v1/shop/upgrade", map[string]any{"birdId": "phantom"})
	if st != http.StatusConflict || codigoDe(body) != "not_owned" {
		t.Errorf("evoluir sem ter: status %d (%v), esperava 409 not_owned", st, body)
	}
	if st, body := a.chama(t, &ana, "POST", "/v1/shop/upgrade", map[string]any{"birdId": DefaultBird}); st != http.StatusNotFound {
		t.Errorf("evoluir o de sempre: status %d (%v), esperava 404", st, body)
	}

	// Sem moedas, nao evolui.
	a.daPassaro(t, ana, "phantom")
	a.daMoedas(t, ana, UpgradePrices[0]-1)
	st, body = a.chama(t, &ana, "POST", "/v1/shop/upgrade", map[string]any{"birdId": "phantom"})
	if st != http.StatusConflict || codigoDe(body) != "not_enough_coins" {
		t.Errorf("evoluir sem moedas: status %d (%v)", st, body)
	}
}

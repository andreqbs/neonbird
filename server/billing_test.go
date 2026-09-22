package main

import (
	"context"
	"net/http"
	"testing"
)

// A compra com dinheiro (billing.go) contra o Google falso de integrity_test.go.
// Cada teste e uma tentativa de ganhar passaro sem pagar — ou de perder o que
// pagou —, junto com o caminho certo.

func possui(t *testing.T, body map[string]any, passaro string) bool {
	t.Helper()
	donos, _ := carteira(t, body)["ownedBirds"].([]any)
	for _, d := range donos {
		if d == passaro {
			return true
		}
	}
	return false
}

func (a *ambiente) compra(t *testing.T, quem jogador, passaro, token string) (int, map[string]any) {
	t.Helper()
	return a.chama(t, &quem, "POST", "/v1/shop/purchase", map[string]any{"birdId": passaro, "purchaseToken": token})
}

func TestCatalogoDizComoSeCompraCadaPassaro(t *testing.T) {
	for _, b := range Birds {
		switch {
		case b.ID == DefaultBird:
			if b.Price != 0 || b.ProductID != "" {
				t.Errorf("o de sempre vem de graca, sem produto: %+v", b)
			}
		case b.ID == "comet":
			if b.Price != 0 || b.ProductID == "" {
				t.Errorf("o Cometa e so com dinheiro: preco %d, produto %q", b.Price, b.ProductID)
			}
		default:
			if b.Price <= 0 || b.ProductID == "" {
				t.Errorf("%s se compra com moedas OU dinheiro: preco %d, produto %q", b.ID, b.Price, b.ProductID)
			}
		}
	}
}

func TestCometaNaoSeCompraComMoedas(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daMoedas(t, ana, 100000)

	st, body := a.chama(t, &ana, "POST", "/v1/shop/buy", map[string]any{"item": "bird", "birdId": "comet"})
	if st != http.StatusConflict || codigoDe(body) != "coins_not_accepted" {
		t.Fatalf("comprar o Cometa com moedas: status %d (%v), esperava 409 coins_not_accepted", st, body)
	}
	_, body = a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if possui(t, body, "comet") || num(t, carteira(t, body)["coins"]) != 100000 {
		t.Errorf("a recusa mexeu na carteira: %v", carteira(t, body))
	}
}

func TestCompraComDinheiroDaOPassaro(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.configCompras())
	ana := a.registra(t, "Ana")
	g.vende("tok-cometa", "bird_comet", 0)

	st, body := a.compra(t, ana, "comet", "tok-cometa")
	if st != http.StatusOK || !possui(t, body, "comet") {
		t.Fatalf("compra paga: status %d (%v)", st, body)
	}
	if !g.foiConfirmada("tok-cometa") {
		t.Error("a compra nao foi confirmada no Google: ele devolveria o dinheiro em 3 dias")
	}
	if num(t, carteira(t, body)["coins"]) != 0 {
		t.Errorf("comprar com dinheiro nao mexe nas moedas: %v", carteira(t, body)["coins"])
	}

	// Mandar de novo (a resposta se perdeu) devolve o mesmo, sem duplicar nada.
	st, body = a.compra(t, ana, "comet", "tok-cometa")
	if st != http.StatusOK || !possui(t, body, "comet") {
		t.Errorf("repetir a compra: status %d (%v)", st, body)
	}
	var linhas int
	if err := a.store.pool.QueryRow(context.Background(),
		`select count(*) from ledger where player_id = $1 and kind = 'buy_bird_money'`, ana.id).Scan(&linhas); err != nil || linhas != 1 {
		t.Errorf("livro-razao: %d linhas de compra (%v), esperava 1", linhas, err)
	}

	// Comprado, da para usar.
	if st, body := a.chama(t, &ana, "POST", "/v1/me/bird", map[string]any{"birdId": "comet"}); st != http.StatusOK {
		t.Errorf("usar o Cometa comprado: status %d (%v)", st, body)
	}
}

func TestCompraQueNaoFoiPagaNaoDaPassaro(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.configCompras())
	ana := a.registra(t, "Ana")

	// Pagamento pendente (boleto): o passaro vem quando aprovar.
	g.vende("tok-boleto", "bird_frost", 2)
	if st, body := a.compra(t, ana, "frost", "tok-boleto"); st != http.StatusAccepted || body["pending"] != true {
		t.Errorf("pagamento pendente: status %d (%v), esperava 202", st, body)
	}
	// Aprovou depois: a mesma compra, mandada de novo, agora da o passaro.
	g.vende("tok-boleto", "bird_frost", 0)
	if st, body := a.compra(t, ana, "frost", "tok-boleto"); st != http.StatusOK || !possui(t, body, "frost") {
		t.Errorf("pagamento aprovado: status %d (%v)", st, body)
	}

	g.vende("tok-cancelada", "bird_ember", 1)
	if st, body := a.compra(t, ana, "ember", "tok-cancelada"); st != http.StatusConflict || codigoDe(body) != "purchase_canceled" {
		t.Errorf("compra cancelada: status %d (%v)", st, body)
	}
	if st, body := a.compra(t, ana, "toxic", "tok-inventado"); st != http.StatusUnprocessableEntity || codigoDe(body) != "purchase_invalid" {
		t.Errorf("token inventado: status %d (%v), esperava 422", st, body)
	}
	// A compra do Geada nao serve para levar o Cometa.
	if st, body := a.compra(t, ana, "comet", "tok-boleto"); st != http.StatusUnprocessableEntity {
		t.Errorf("compra de outro passaro: status %d (%v), esperava 422", st, body)
	}
	if st, body := a.compra(t, ana, DefaultBird, "tok-boleto"); st != http.StatusNotFound {
		t.Errorf("comprar o de sempre: status %d (%v), esperava 404", st, body)
	}
}

// O app reinstalado ganha outro codigo de jogador, mas a conta do Google e a
// mesma: a compra vem junto, e o passaro muda de conta.
func TestCompraVoltaNoAppReinstalado(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.configCompras())
	antiga := a.registra(t, "Ana")
	nova := a.registra(t, "Ana de novo")
	g.vende("tok-fantasma", "bird_phantom", 0)

	if st, body := a.compra(t, antiga, "phantom", "tok-fantasma"); st != http.StatusOK {
		t.Fatalf("compra: status %d (%v)", st, body)
	}
	a.chama(t, &antiga, "POST", "/v1/me/bird", map[string]any{"birdId": "phantom"})

	st, body := a.compra(t, nova, "phantom", "tok-fantasma")
	if st != http.StatusOK || !possui(t, body, "phantom") {
		t.Fatalf("restaurar na conta nova: status %d (%v)", st, body)
	}
	_, body = a.chama(t, &antiga, "GET", "/v1/me/wallet", nil)
	if possui(t, body, "phantom") {
		t.Error("a mesma compra ficou valendo nas duas contas")
	}
	if carteira(t, body)["equippedBird"] != DefaultBird {
		t.Errorf("a conta antiga ficou usando o passaro que saiu: %v", carteira(t, body)["equippedBird"])
	}
}

func TestCompraEstornadaTiraOPassaro(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.configCompras())
	ana := a.registra(t, "Ana")
	g.vende("tok-estorno", "bird_comet", 0)
	if st, body := a.compra(t, ana, "comet", "tok-estorno"); st != http.StatusOK {
		t.Fatalf("compra: status %d (%v)", st, body)
	}
	a.chama(t, &ana, "POST", "/v1/me/bird", map[string]any{"birdId": "comet"})

	g.estorna("tok-estorno")
	g.estorna("tok-de-outro-jogo") // o Google lista tudo; o que nao e daqui passa batido
	compras, err := NewPlayBilling(a.cfg)
	if err != nil {
		t.Fatalf("compra com dinheiro: %v", err)
	}
	n, err := syncVoidedPurchases(context.Background(), a.store, compras)
	if err != nil || n != 1 {
		t.Fatalf("conferir estornos: %d (%v), esperava 1", n, err)
	}

	_, body := a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if possui(t, body, "comet") || carteira(t, body)["equippedBird"] != DefaultBird {
		t.Errorf("depois do estorno: %v", carteira(t, body))
	}
	// Conferir de novo nao anula nada a mais, e a compra estornada nao volta.
	if n, _ := syncVoidedPurchases(context.Background(), a.store, compras); n != 0 {
		t.Errorf("segunda conferencia anulou %d", n)
	}
	if st, body := a.compra(t, ana, "comet", "tok-estorno"); st != http.StatusConflict || codigoDe(body) != "purchase_voided" {
		t.Errorf("reusar a compra estornada: status %d (%v), esperava 409 purchase_voided", st, body)
	}
}

func TestSemContaDeServicoNaoHaCompraComDinheiro(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	st, body := a.compra(t, ana, "comet", "tok-qualquer")
	if st != http.StatusServiceUnavailable || codigoDe(body) != "billing_unavailable" {
		t.Errorf("sem conta de servico: status %d (%v), esperava 503", st, body)
	}
}

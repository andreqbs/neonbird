package main

import (
	"context"
	"net/http"
	"testing"
)

// As skins (catalog.go): enfeites que so mudam o visual do passaro. Cada teste
// e uma tentativa de vestir o que nao comprou, de pagar duas vezes ou de ficar
// com o que foi estornado — junto com o caminho certo. E o ranking, que mostra
// a aparencia de cada jogador para os outros.

func temSkin(t *testing.T, body map[string]any, skin string) bool {
	t.Helper()
	donas, _ := carteira(t, body)["ownedSkins"].([]any)
	for _, d := range donas {
		if d == skin {
			return true
		}
	}
	return false
}

// vestida: a skin que a carteira diz estar em uso naquele encaixe ("" = nada).
func vestida(t *testing.T, body map[string]any, encaixe string) string {
	t.Helper()
	usando, _ := carteira(t, body)["equippedSkins"].(map[string]any)
	s, _ := usando[encaixe].(string)
	return s
}

func (a *ambiente) compraSkin(t *testing.T, quem jogador, skin string) (int, map[string]any) {
	t.Helper()
	return a.chama(t, &quem, "POST", "/v1/shop/buy", map[string]any{"item": "skin", "skinId": skin})
}

func (a *ambiente) veste(t *testing.T, quem jogador, corpo map[string]any) (int, map[string]any) {
	t.Helper()
	return a.chama(t, &quem, "POST", "/v1/me/skin", corpo)
}

func (a *ambiente) compraSkinComDinheiro(t *testing.T, quem jogador, skin, token string) (int, map[string]any) {
	t.Helper()
	return a.chama(t, &quem, "POST", "/v1/shop/purchase", map[string]any{"skinId": skin, "purchaseToken": token})
}

func TestCatalogoDasSkins(t *testing.T) {
	porEncaixe := map[string]int{}
	ids, produtos := map[string]bool{}, map[string]bool{}
	for _, b := range Birds {
		if b.ProductID != "" {
			produtos[b.ProductID] = true
		}
	}
	for _, s := range Skins {
		if ids[s.ID] {
			t.Errorf("skin repetida: %s", s.ID)
		}
		ids[s.ID] = true
		if !skinSlotExists(s.Slot) {
			t.Errorf("%s: o encaixe %q nao existe", s.ID, s.Slot)
		}
		if s.Price <= 0 && s.ProductID == "" {
			t.Errorf("%s nao se compra de jeito nenhum: sem preco em moedas e sem produto", s.ID)
		}
		if s.ProductID != "" {
			if produtos[s.ProductID] {
				t.Errorf("%s: o produto %q ja e de outro item no Play Console", s.ID, s.ProductID)
			}
			produtos[s.ProductID] = true
		}
		porEncaixe[s.Slot]++
	}
	for _, e := range SkinSlots {
		if porEncaixe[e.ID] < 3 {
			t.Errorf("%s: %d skins, esperava pelo menos 3", e.Name, porEncaixe[e.ID])
		}
	}

	// A loja do app le tudo do catalogo da API.
	a := novoAmbiente(t, nil)
	st, body := a.chama(t, nil, "GET", "/v1/catalog", nil)
	skins, _ := body["skins"].([]any)
	encaixes, _ := body["skinSlots"].([]any)
	if st != http.StatusOK || len(skins) != len(Skins) || len(encaixes) != len(SkinSlots) {
		t.Errorf("catalogo: status %d, %d skins e %d encaixes", st, len(skins), len(encaixes))
	}
}

func TestComprarEVestirSkin(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daMoedas(t, ana, 1000)
	vermelho, _ := skinByID("cap_red")

	// Sem comprar, nao veste.
	if st, body := a.veste(t, ana, map[string]any{"skinId": "cap_red"}); st != http.StatusForbidden || codigoDe(body) != "not_owned" {
		t.Errorf("vestir sem ter: status %d (%v), esperava 403 not_owned", st, body)
	}

	st, body := a.compraSkin(t, ana, "cap_red")
	if st != http.StatusOK || !temSkin(t, body, "cap_red") {
		t.Fatalf("comprar o bone: status %d (%v)", st, body)
	}
	if got := num(t, carteira(t, body)["coins"]); got != 1000-vermelho.Price {
		t.Errorf("saldo depois do bone: %d, esperava %d", got, 1000-vermelho.Price)
	}
	if vestida(t, body, "cap") != "" {
		t.Error("comprar nao veste sozinho: o jogador escolhe quando usar")
	}
	// Comprar de novo nao cobra duas vezes.
	if st, body := a.compraSkin(t, ana, "cap_red"); st != http.StatusConflict || codigoDe(body) != "already_owned" {
		t.Errorf("comprar o mesmo bone de novo: status %d (%v)", st, body)
	}

	if st, body = a.veste(t, ana, map[string]any{"skinId": "cap_red"}); st != http.StatusOK || vestida(t, body, "cap") != "cap_red" {
		t.Fatalf("vestir o bone: status %d (%v)", st, body)
	}

	// Outro bone no mesmo encaixe troca, nao soma: um bone por vez.
	a.compraSkin(t, ana, "cap_neon")
	_, body = a.veste(t, ana, map[string]any{"skinId": "cap_neon"})
	if vestida(t, body, "cap") != "cap_neon" || !temSkin(t, body, "cap_red") {
		t.Errorf("trocar de bone: %v", carteira(t, body))
	}

	// Encaixes diferentes convivem.
	a.compraSkin(t, ana, "glasses_3d")
	_, body = a.veste(t, ana, map[string]any{"skinId": "glasses_3d"})
	if vestida(t, body, "cap") != "cap_neon" || vestida(t, body, "glasses") != "glasses_3d" {
		t.Errorf("bone e oculos juntos: %v", carteira(t, body)["equippedSkins"])
	}

	// Tirar o bone deixa os oculos onde estao.
	st, body = a.veste(t, ana, map[string]any{"slot": "cap"})
	if st != http.StatusOK || vestida(t, body, "cap") != "" || vestida(t, body, "glasses") != "glasses_3d" {
		t.Errorf("tirar o bone: status %d (%v)", st, carteira(t, body)["equippedSkins"])
	}

	// Encaixe e skin que nao existem.
	if st, body := a.veste(t, ana, map[string]any{"slot": "chapeu"}); st != http.StatusNotFound || codigoDe(body) != "slot_not_found" {
		t.Errorf("encaixe inventado: status %d (%v)", st, body)
	}
	if st, body := a.veste(t, ana, map[string]any{"skinId": "cap_dourado"}); st != http.StatusNotFound || codigoDe(body) != "skin_not_found" {
		t.Errorf("vestir skin inventada: status %d (%v)", st, body)
	}
	if st, body := a.compraSkin(t, ana, "cap_dourado"); st != http.StatusNotFound || codigoDe(body) != "skin_not_found" {
		t.Errorf("comprar skin inventada: status %d (%v)", st, body)
	}
}

func TestSkinSemMoedasSuficientesNaoSai(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	diamante, _ := skinByID("necklace_diamond")
	a.daMoedas(t, ana, diamante.Price-1)

	if st, body := a.compraSkin(t, ana, diamante.ID); st != http.StatusConflict || codigoDe(body) != "not_enough_coins" {
		t.Errorf("comprar sem moedas: status %d (%v)", st, body)
	}
	_, body := a.chama(t, &ana, "GET", "/v1/me/wallet", nil)
	if temSkin(t, body, diamante.ID) || num(t, carteira(t, body)["coins"]) != diamante.Price-1 {
		t.Errorf("a recusa mexeu na carteira: %v", carteira(t, body))
	}
}

func TestSkinComDinheiro(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.configCompras())
	antiga := a.registra(t, "Ana")
	nova := a.registra(t, "Ana de novo")
	morcego, _ := skinByID("wings_bat")
	g.vende("tok-morcego", morcego.ProductID, 0)

	st, body := a.compraSkinComDinheiro(t, antiga, "wings_bat", "tok-morcego")
	if st != http.StatusOK || !temSkin(t, body, "wings_bat") || body["skinId"] != "wings_bat" {
		t.Fatalf("compra paga: status %d (%v)", st, body)
	}
	if !g.foiConfirmada("tok-morcego") {
		t.Error("a compra nao foi confirmada no Google: ele devolveria o dinheiro em 3 dias")
	}
	if num(t, carteira(t, body)["coins"]) != 0 {
		t.Errorf("comprar com dinheiro nao mexe nas moedas: %v", carteira(t, body)["coins"])
	}
	// Mandar de novo (a resposta se perdeu) devolve o mesmo, sem duplicar nada.
	if st, body := a.compraSkinComDinheiro(t, antiga, "wings_bat", "tok-morcego"); st != http.StatusOK || !temSkin(t, body, "wings_bat") {
		t.Errorf("repetir a compra: status %d (%v)", st, body)
	}
	var linhas int
	if err := a.store.pool.QueryRow(context.Background(),
		`select count(*) from ledger where player_id = $1 and kind = 'buy_skin_money'`, antiga.id).Scan(&linhas); err != nil || linhas != 1 {
		t.Errorf("livro-razao: %d linhas de compra (%v), esperava 1", linhas, err)
	}
	a.veste(t, antiga, map[string]any{"skinId": "wings_bat"})

	// A compra das asas nao serve para levar outra skin, nem um passaro.
	if st, body := a.compraSkinComDinheiro(t, antiga, "wings_angel", "tok-morcego"); st != http.StatusUnprocessableEntity {
		t.Errorf("compra de outra skin: status %d (%v), esperava 422", st, body)
	}
	if st, body := a.compra(t, antiga, "comet", "tok-morcego"); st != http.StatusUnprocessableEntity {
		t.Errorf("compra de skin levando passaro: status %d (%v), esperava 422", st, body)
	}

	// App reinstalado: a skin muda de conta — e sai do corpo da antiga.
	if st, body := a.compraSkinComDinheiro(t, nova, "wings_bat", "tok-morcego"); st != http.StatusOK || !temSkin(t, body, "wings_bat") {
		t.Fatalf("restaurar na conta nova: status %d (%v)", st, body)
	}
	_, body = a.chama(t, &antiga, "GET", "/v1/me/wallet", nil)
	if temSkin(t, body, "wings_bat") || vestida(t, body, "wings") != "" {
		t.Errorf("a mesma compra ficou valendo nas duas contas: %v", carteira(t, body))
	}

	// Estorno: sai da conta nova, e do corpo.
	a.veste(t, nova, map[string]any{"skinId": "wings_bat"})
	g.estorna("tok-morcego")
	compras, err := NewPlayBilling(a.cfg)
	if err != nil {
		t.Fatalf("compra com dinheiro: %v", err)
	}
	if n, err := syncVoidedPurchases(context.Background(), a.store, compras); err != nil || n != 1 {
		t.Fatalf("conferir estornos: %d (%v), esperava 1", n, err)
	}
	_, body = a.chama(t, &nova, "GET", "/v1/me/wallet", nil)
	if temSkin(t, body, "wings_bat") || vestida(t, body, "wings") != "" {
		t.Errorf("depois do estorno: %v", carteira(t, body))
	}
	if st, body := a.compraSkinComDinheiro(t, nova, "wings_bat", "tok-morcego"); st != http.StatusConflict || codigoDe(body) != "purchase_voided" {
		t.Errorf("reusar a compra estornada: status %d (%v), esperava 409 purchase_voided", st, body)
	}
}

// aparenciaDe acha no ranking a linha do jogador e devolve a aparencia dela.
func aparenciaDe(t *testing.T, linhas []any, id string) map[string]any {
	t.Helper()
	for _, x := range linhas {
		l, _ := x.(map[string]any)
		if l["id"] == id {
			cara, ok := l["look"].(map[string]any)
			if !ok {
				t.Fatalf("linha sem aparencia: %v", l)
			}
			return cara
		}
	}
	t.Fatalf("jogador %s fora da lista: %v", id, linhas)
	return nil
}

func TestRankingMostraAAparenciaDeCadaJogador(t *testing.T) {
	exigeRodadaAberta(t)
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	bia := a.registra(t, "Bia")
	a.daMoedas(t, ana, 1000)
	a.daPassaro(t, ana, "frost")
	for _, s := range []string{"cap_propeller", "glasses_pixel", "necklace_chain"} {
		if st, body := a.compraSkin(t, ana, s); st != http.StatusOK {
			t.Fatalf("comprar %s: status %d (%v)", s, st, body)
		}
	}
	a.veste(t, ana, map[string]any{"skinId": "cap_propeller"})
	a.veste(t, ana, map[string]any{"skinId": "glasses_pixel"})
	a.pontua(t, ana, 30)
	a.pontua(t, bia, 10)

	st, body := a.chama(t, nil, "GET", "/v1/rankings/players", nil)
	linhas, _ := body["rows"].([]any)
	if st != http.StatusOK || len(linhas) != 2 {
		t.Fatalf("ranking: status %d (%v)", st, body)
	}

	cara := aparenciaDe(t, linhas, ana.id)
	skins, _ := cara["skins"].(map[string]any)
	if cara["bird"] != "frost" || skins["cap"] != "cap_propeller" || skins["glasses"] != "glasses_pixel" || len(skins) != 2 {
		t.Errorf("a aparencia da Ana: %v", cara)
	}
	colecao, _ := cara["ownedSkins"].([]any)
	if len(colecao) != 3 {
		t.Errorf("a colecao da Ana tem 3 skins (uma guardada): %v", colecao)
	}
	// So o visual: nada de moeda, compra ou estrela na aparencia.
	if len(cara) != 3 {
		t.Errorf("a aparencia leva so passaro, skins e colecao: %v", cara)
	}

	// Quem nao comprou nada aparece com o de sempre — e lista vazia, nao nula.
	cara = aparenciaDe(t, linhas, bia.id)
	skins, okSkins := cara["skins"].(map[string]any)
	colecao, okColecao := cara["ownedSkins"].([]any)
	if cara["bird"] != DefaultBird || !okSkins || len(skins) != 0 || !okColecao || len(colecao) != 0 {
		t.Errorf("a aparencia da Bia: %v", cara)
	}
}

func TestGrupoMostraAAparenciaDosMembros(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	a.daMoedas(t, ana, 1000)
	a.compraSkin(t, ana, "necklace_medal")
	a.veste(t, ana, map[string]any{"skinId": "necklace_medal"})

	if st, body := a.chama(t, &ana, "POST", "/v1/groups", map[string]any{"name": "Os Bravos"}); st != http.StatusOK {
		t.Skipf("grupo fora da rodada (status %d: %v)", st, body)
	}
	st, body := a.chama(t, &ana, "GET", "/v1/groups/me", nil)
	grupo, _ := body["group"].(map[string]any)
	membros, _ := grupo["members"].([]any)
	if st != http.StatusOK || len(membros) != 1 {
		t.Fatalf("meu grupo: status %d (%v)", st, body)
	}
	cara := aparenciaDe(t, membros, ana.id)
	skins, _ := cara["skins"].(map[string]any)
	if skins["necklace"] != "necklace_medal" {
		t.Errorf("a aparencia da Ana no grupo: %v", cara)
	}
}

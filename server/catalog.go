package main

// O catalogo da loja e as regras da economia do jogo.
//
// Tudo isto mora no SERVIDOR de proposito. O app recebe precos, bonus e limites
// a cada abertura (GET /v1/catalog) e so os mostra: quem faz a conta de verdade
// e o servidor. Mudar um preco e redeploy daqui, nao build nova na loja — e um
// app modificado nao consegue "baratear" nada, porque o desconto na carteira
// acontece aqui.

const (
	// Partidas que o jogador tem antes de precisar do video premiado.
	MaxLives = 5

	// Uma moeda a cada CoinEvery obstaculos, em media. A posicao exata sai da
	// semente da partida (coins.go).
	CoinEvery = 3

	// Obstaculos por fase — o mesmo STAGE_LENGTH do app. Fechar uma fase rende
	// StageBonus moedas.
	StageLength = 100
	StageBonus  = 10

	// Novas chances por partida. Uma so: continuar de onde caiu e um presente,
	// e sem limite o ranking viraria disputa de quem guardou mais moeda.
	MaxContinuesPerRun = 1

	// Precos de TESTE, em moedas.
	ShieldPrice   = 60
	ContinuePrice = 100

	// Teto de escudos e novas chances guardados. So existe para nenhum saldo
	// virar numero absurdo por engano.
	MaxStock = 99

	// O passaro de sempre: de graca, ja vem com a conta e nao tem habilidade.
	DefaultBird = "classic"
)

// Ability e a vaga da habilidade de um passaro.
//
// As habilidades ainda nao existem: cada passaro novo ja nasce com o `id` da
// sua, e `status: "soon"` diz ao app para mostrar "em breve". Quando uma for
// definida, ela ganha comportamento no app (src/game/abilities.js) e, se mexer
// em moeda ou pontuacao, a regra correspondente aqui no servidor — senao a
// conferencia da partida recusaria o que a habilidade legitimamente rendeu.
type Ability struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type BirdOffer struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Tagline string   `json:"tagline"`
	Price   int      `json:"price"`
	Ability *Ability `json:"ability"`
}

// Birds: o de sempre e os cinco da loja. Precos de teste.
var Birds = []BirdOffer{
	{ID: DefaultBird, Name: "Major", Tagline: "O piloto de sempre.", Price: 0, Ability: nil},
	{ID: "frost", Name: "Geada", Tagline: "Cristais no topete, asa de neve.", Price: 150, Ability: &Ability{ID: "frost", Status: "soon"}},
	{ID: "ember", Name: "Brasa", Tagline: "Topete em chamas, humor idem.", Price: 320, Ability: &Ability{ID: "ember", Status: "soon"}},
	{ID: "toxic", Name: "Toxina", Tagline: "Máscara roxa, antena ligada.", Price: 480, Ability: &Ability{ID: "toxic", Status: "soon"}},
	{ID: "phantom", Name: "Fantasma", Tagline: "Meio transparente, todo visor.", Price: 750, Ability: &Ability{ID: "phantom", Status: "soon"}},
	{ID: "comet", Name: "Cometa", Tagline: "Deixa um rastro por onde passa.", Price: 1200, Ability: &Ability{ID: "comet", Status: "soon"}},
}

func birdByID(id string) (BirdOffer, bool) {
	for _, b := range Birds {
		if b.ID == id {
			return b, true
		}
	}
	return BirdOffer{}, false
}

type ItemOffer struct {
	Price int `json:"price"`
}

type Rules struct {
	MaxLives           int `json:"maxLives"`
	CoinEvery          int `json:"coinEvery"`
	StageLength        int `json:"stageLength"`
	StageBonus         int `json:"stageBonus"`
	MaxContinuesPerRun int `json:"maxContinuesPerRun"`
	MaxStock           int `json:"maxStock"`
}

type Catalog struct {
	Birds []BirdOffer          `json:"birds"`
	Items map[string]ItemOffer `json:"items"`
	Rules Rules                `json:"rules"`
}

func CurrentCatalog() Catalog {
	return Catalog{
		Birds: Birds,
		Items: map[string]ItemOffer{
			"shield":   {Price: ShieldPrice},
			"continue": {Price: ContinuePrice},
		},
		Rules: Rules{
			MaxLives:           MaxLives,
			CoinEvery:          CoinEvery,
			StageLength:        StageLength,
			StageBonus:         StageBonus,
			MaxContinuesPerRun: MaxContinuesPerRun,
			MaxStock:           MaxStock,
		},
	}
}

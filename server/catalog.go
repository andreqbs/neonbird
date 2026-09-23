package main

import (
	"fmt"
	"strconv"
	"strings"
)

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
	ShieldPrice   = 5 //60
	ContinuePrice = 5 //100

	// Teto de escudos e novas chances guardados. So existe para nenhum saldo
	// virar numero absurdo por engano.
	MaxStock = 99

	// O passaro de sempre: de graca, ja vem com a conta e nao tem poder.
	DefaultBird = "classic"

	// Estrelas de um passaro: cada uma comprada com moedas estica o tempo do
	// poder dele (ver os poderes, abaixo). Passaro recem-comprado tem zero.
	MaxBirdLevel = 5
)

// UpgradePrices: quanto custa, em moedas, cada estrela — a primeira, a segunda,
// ate a quinta. Precos de teste.
var UpgradePrices = [MaxBirdLevel]int{10, 20, 40, 80, 160}

// ==================================================================== PODERES
//
// Cada passaro da loja tem um ou mais poderes. O `ID` e o que o app reconhece
// para dar o comportamento no voo (src/game/powers.js); `Name` e `Description`
// vao para a loja; `Params` sao os numeros do efeito. O app le tudo daqui, a
// cada partida — mudar um numero ou trocar um poder de passaro e redeploy deste
// servidor, sem build nova do app.
//
// Poder que mexe em MOEDA ou em NOVA CHANCE vale pela regra deste servidor
// (economy.go), pelo passaro registrado na ABERTURA da partida: trocar de
// passaro no meio nao muda o que ela rende, e um app adulterado nao inventa
// poder que o servidor nao deu.
type Power struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Params      map[string]float64 `json:"params"`
	// O numero que cresce com as estrelas do passaro, e a tabela dele por nivel
	// (0 a 5). `Params` ja vem com o valor do nivel de quem pediu; a tabela vai
	// junto para a loja mostrar o que a proxima estrela muda.
	LevelParam  string    `json:"levelParam,omitempty"`
	LevelValues []float64 `json:"levelValues,omitempty"`
}

// atLevel devolve o poder com o numero daquele nivel (estrelas).
func (p Power) atLevel(level int) Power {
	if p.LevelParam == "" || len(p.LevelValues) == 0 {
		return p
	}
	level = min(max(level, 0), len(p.LevelValues)-1)
	params := make(map[string]float64, len(p.Params))
	for k, v := range p.Params {
		params[k] = v
	}
	params[p.LevelParam] = p.LevelValues[level]
	p.Params = params
	return p
}

// Os poderes que o app sabe executar. Poder novo precisa de comportamento em
// src/game/powers.js com o mesmo id — o app ignora id que nao conhece.
const (
	PowerIDMagnet         = "magnet"
	PowerIDGhost          = "ghost"
	PowerIDSlow           = "slow"
	PowerIDExtraChance    = "extraChance"
	PowerIDCoinMultiplier = "coinMultiplier"
)

// ----------------------------------------------------------------------------
// OS NUMEROS DE CADA PODER. Mudou aqui, a frase da loja acompanha sozinha.
// ----------------------------------------------------------------------------
//
// Os poderes com relogio crescem com as ESTRELAS do passaro: a lista e o tempo
// ligado em cada nivel, de 0 (sem estrela) a 5. Cada estrela se compra com
// moedas na loja (UpgradePrices, mais abaixo).
var (
	// Ima: 4 s ligados sem estrela e 8 s com cinco; recarrega 10 s, puxando as
	// moedas a ate 5 raios do passaro (o app limita a 8, ver World.js).
	PowerMagnet = magnetPower([]float64{4, 5, 6, 7, 7.5, 8}, 10, 5)

	// Invisivel: atravessa os obstaculos por 2 s sem estrela, 6 s com cinco;
	// recarrega 10 s.
	PowerGhost = ghostPower([]float64{2, 2.5, 3, 3.5, 4, 6}, 10)

	// Mais lento: 2 s sem estrela, 6 s com cinco, sempre 20% mais devagar;
	// recarrega 10 s.
	PowerSlow = slowPower([]float64{2, 2.5, 3, 3.5, 4, 6}, 10, 20)

	// Segunda chance: 1 nova chance a mais por partida — true = so com video.
	PowerSecondChance = extraChancePower(1, true)

	// Moedas em dobro: as moedas pegas no voo valem 2x no fim da partida (o
	// bonus de fase fechada nao dobra).
	PowerDoubleCoins = coinMultiplierPower(2)
)

// Os tres poderes com relogio ligam SOZINHOS, em ciclo: a partida comeca
// recarregando, liga, recarrega de novo — so contando o tempo de voo.

func magnetPower(ligado []float64, recarga, alcance float64) Power {
	return Power{
		ID:   PowerIDMagnet,
		Name: "Ímã",
		Description: fmt.Sprintf("Puxa as moedas por perto: %s ligado (%s com 5 estrelas), %s recarregando.",
			segundos(ligado[0]), segundos(ultimo(ligado)), segundos(recarga)),
		Params:      map[string]float64{"activeSeconds": ligado[0], "cooldownSeconds": recarga, "reach": alcance},
		LevelParam:  "activeSeconds",
		LevelValues: ligado,
	}
}

func ghostPower(ligado []float64, recarga float64) Power {
	return Power{
		ID:   PowerIDGhost,
		Name: "Invisível",
		Description: fmt.Sprintf("Atravessa os obstáculos sem cair: %s invisível (%s com 5 estrelas), %s recarregando.",
			segundos(ligado[0]), segundos(ultimo(ligado)), segundos(recarga)),
		Params:      map[string]float64{"activeSeconds": ligado[0], "cooldownSeconds": recarga},
		LevelParam:  "activeSeconds",
		LevelValues: ligado,
	}
}

func slowPower(ligado []float64, recarga, porcento float64) Power {
	return Power{
		ID:   PowerIDSlow,
		Name: "Câmera lenta",
		Description: fmt.Sprintf("A fase anda %s%% mais devagar por %s (%s com 5 estrelas); depois recarrega %s.",
			numero(porcento), segundos(ligado[0]), segundos(ultimo(ligado)), segundos(recarga)),
		Params:      map[string]float64{"activeSeconds": ligado[0], "cooldownSeconds": recarga, "percent": porcento},
		LevelParam:  "activeSeconds",
		LevelValues: ligado,
	}
}

func ultimo(v []float64) float64 { return v[len(v)-1] }

func extraChancePower(extras int, soComVideo bool) Power {
	nome, frase := "Segunda chance", "Uma nova chance a mais por partida"
	if extras > 1 {
		nome, frase = fmt.Sprintf("+%d chances", extras), fmt.Sprintf("%d novas chances a mais por partida", extras)
	}
	video := 0.0
	if soComVideo {
		video = 1
		frase += ", assistindo a um vídeo"
	}
	return Power{
		ID:          PowerIDExtraChance,
		Name:        nome,
		Description: frase + ".",
		Params:      map[string]float64{"extra": float64(extras), "videoOnly": video},
	}
}

func coinMultiplierPower(vezes int) Power {
	nome, frase := "Moedas em dobro", "As moedas pegas no voo valem o dobro no fim da partida."
	if vezes != 2 {
		nome = fmt.Sprintf("Moedas ×%d", vezes)
		frase = fmt.Sprintf("As moedas pegas no voo valem %d vezes mais no fim da partida.", vezes)
	}
	return Power{
		ID:          PowerIDCoinMultiplier,
		Name:        nome,
		Description: frase,
		Params:      map[string]float64{"multiplier": float64(vezes)},
	}
}

// numero escreve 2,5 em vez de 2.5 — a loja e em portugues.
func numero(v float64) string {
	return strings.Replace(strconv.FormatFloat(v, 'f', -1, 64), ".", ",", 1)
}

func segundos(v float64) string { return numero(v) + " s" }

// ==================================================================== PASSAROS

type BirdOffer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Tagline string `json:"tagline"`
	// Preco em moedas. 0 = nao se compra com moedas (o de sempre ja vem de graca).
	Price int `json:"price"`
	// O produto no Play Console, para a compra com dinheiro. Vazio = nao se
	// compra com dinheiro. O VALOR em reais e o que estiver cadastrado la: o app
	// mostra o preco que o Google Play informar.
	ProductID string  `json:"productId,omitempty"`
	Powers    []Power `json:"powers"`
	// Evolui com estrelas compradas com moedas? A Brasa e o Cometa nao evoluem:
	// o poder deles nao e de tempo, entao ja nascem com as cinco estrelas.
	Upgradable bool `json:"upgradable"`
	// Quantas estrelas ele chega a ter (0 = passaro sem poder). So sai daqui
	// para o app; e sempre MaxBirdLevel para quem tem poder.
	MaxStars int `json:"maxStars"`
	// Quanto custa cada estrela, em moedas, do primeiro ao ultimo nivel.
	UpgradePrices []int `json:"upgradePrices,omitempty"`
}

// ----------------------------------------------------------------------------
// COMO SE COMPRA: `Price` e o preco em moedas (0 = so com dinheiro) e
// `ProductID` e o produto no Play Console (vazio = so com moedas). Com os dois,
// o jogador escolhe. O produto tem que existir no Play Console com EXATAMENTE
// este id (Monetizar > Produtos > Produtos no app) — ver server/README.md.
//
// QUEM TEM QUAL PODER: a lista `Powers` de cada passaro. Trocar o poder de um
// passaro e trocar o nome entre as chaves; dar mais de um e separar por
// virgula — por exemplo `Powers: []Power{PowerMagnet, PowerDoubleCoins}`.
// Precos de teste.
// ----------------------------------------------------------------------------
var Birds = []BirdOffer{
	{ID: DefaultBird, Name: "Major", Tagline: "O piloto de sempre.", Price: 0},
	{ID: "frost", Name: "Geada", Tagline: "Cristais no topete, asa de neve.", Price: 10, ProductID: "bird_frost", Powers: []Power{PowerSlow}, Upgradable: true},
// 	{ID: "frost", Name: "Geada", Tagline: "Cristais no topete, asa de neve.", Price: 150, ProductID: "bird_frost", Powers: []Power{PowerSlow}, Upgradable: true},
	{ID: "ember", Name: "Brasa", Tagline: "Topete em chamas, humor idem.", Price: 12, ProductID: "bird_ember", Powers: []Power{PowerSecondChance}},
// 	{ID: "ember", Name: "Brasa", Tagline: "Topete em chamas, humor idem.", Price: 320, ProductID: "bird_ember", Powers: []Power{PowerSecondChance}},
	{ID: "toxic", Name: "Toxina", Tagline: "Máscara roxa, antena ligada.", Price: 16, ProductID: "bird_toxic", Powers: []Power{PowerMagnet}, Upgradable: true},
// 	{ID: "toxic", Name: "Toxina", Tagline: "Máscara roxa, antena ligada.", Price: 480, ProductID: "bird_toxic", Powers: []Power{PowerMagnet}, Upgradable: true},
	{ID: "phantom", Name: "Fantasma", Tagline: "Meio transparente, todo visor.", Price: 18, ProductID: "bird_phantom", Powers: []Power{PowerGhost}, Upgradable: true},
// 	{ID: "phantom", Name: "Fantasma", Tagline: "Meio transparente, todo visor.", Price: 750, ProductID: "bird_phantom", Powers: []Power{PowerGhost}, Upgradable: true},
	{ID: "comet", Name: "Cometa", Tagline: "Deixa um rastro por onde passa.", Price: 0, ProductID: "bird_comet", Powers: []Power{PowerDoubleCoins}},
// 	{ID: "comet", Name: "Cometa", Tagline: "Deixa um rastro por onde passa.", Price: 0, ProductID: "bird_comet", Powers: []Power{PowerDoubleCoins}},
}

func birdByID(id string) (BirdOffer, bool) {
	for _, b := range Birds {
		if b.ID == id {
			return b, true
		}
	}
	return BirdOffer{}, false
}

// birdOrDefault: o passaro do catalogo — ou o de sempre, se o id saiu do catalogo.
func birdOrDefault(id string) BirdOffer {
	if b, ok := birdByID(id); ok {
		return b
	}
	b, _ := birdByID(DefaultBird)
	return b
}

// starsFor: quantas estrelas valem para este passaro. O que nao evolui (Brasa,
// Cometa) ja esta no maximo; o que nao tem poder nao tem estrela.
func (b BirdOffer) starsFor(level int) int {
	if len(b.Powers) == 0 {
		return 0
	}
	if !b.Upgradable {
		return MaxBirdLevel
	}
	return min(max(level, 0), MaxBirdLevel)
}

// powersAtLevel: os poderes do passaro no nivel (estrelas) que o jogador tem.
func (b BirdOffer) powersAtLevel(level int) []Power {
	estrelas := b.starsFor(level)
	poderes := make([]Power, 0, len(b.Powers))
	for _, p := range b.Powers {
		poderes = append(poderes, p.atLevel(estrelas))
	}
	return poderes
}

// UpgradePrice: quanto custa a proxima estrela deste passaro (0 = nao da para
// evoluir, ou ja esta no maximo).
func (b BirdOffer) UpgradePrice(level int) int {
	if !b.Upgradable || len(b.Powers) == 0 || level < 0 || level >= MaxBirdLevel {
		return 0
	}
	return UpgradePrices[level]
}

// powerList: os poderes do passaro, sempre como lista (vazia para o de sempre).
func (b BirdOffer) powerList() []Power {
	if b.Powers == nil {
		return []Power{}
	}
	return b.Powers
}

// extraContinues: quantas novas chances a mais por partida os poderes dao.
func (b BirdOffer) extraContinues() int {
	extras := 0
	for _, p := range b.Powers {
		if p.ID == PowerIDExtraChance {
			extras += int(p.Params["extra"])
		}
	}
	return extras
}

// coinMultiplier: por quanto as moedas pegas no voo sao multiplicadas (1 = normal).
func (b BirdOffer) coinMultiplier() int {
	vezes := 1
	for _, p := range b.Powers {
		if p.ID == PowerIDCoinMultiplier && p.Params["multiplier"] >= 1 {
			vezes *= int(p.Params["multiplier"])
		}
	}
	return vezes
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
	birds := make([]BirdOffer, len(Birds))
	for i, b := range Birds {
		b.Powers = b.powerList()
		b.MaxStars = b.starsFor(MaxBirdLevel)
		if b.Upgradable {
			b.UpgradePrices = UpgradePrices[:]
		}
		birds[i] = b
	}
	return Catalog{
		Birds: birds,
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

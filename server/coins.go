package main

import "strings"

// Onde ficam as moedas de uma partida — a mesma conta de src/game/coins.js.
//
// A semente e sorteada aqui quando a partida abre. O app decide com ela, a cada
// obstaculo, se ali tem moedas: uma LETRA de moedas, na ordem de MAJOR FLYER, que
// recomeca do M a cada fase. Ao fechar a partida o app manda o numero do
// obstaculo uma vez para cada moeda que pegou, e o servidor refaz a conta: vale
// ate o total de moedas da letra daquele obstaculo. Moeda de obstaculo que nao
// tinha letra, ou depois do ponto aonde o jogador chegou, simplesmente nao conta.
//
// Aritmetica de 32 bits com estouro, identica ao `Math.imul(...) >>> 0` do
// JavaScript. Os valores de referencia estao em coins_test.go e no selftest do
// app: se um lado mudar sem o outro, os dois testes quebram.

func mix32(x uint32) uint32 {
	x ^= x >> 16
	x *= 0x7feb352d
	x ^= x >> 15
	x *= 0x846ca68b
	x ^= x >> 16
	return x
}

// CoinWord: a palavra que as moedas escrevem, uma letra por obstaculo com
// moedas — a mesma ordem de COIN_WORD em src/game/coins.js.
var CoinWord = []byte("MAJORFLYER")

// letterRows: o desenho de cada letra, igual ao LETTER_ROWS do app (5 linhas,
// X = moeda). O servidor so usa o total de moedas de cada uma.
var letterRows = map[byte][]string{
	'M': {"X...X", "XX.XX", "X.X.X", "X...X", "X...X"},
	'A': {".XX.", "X..X", "XXXX", "X..X", "X..X"},
	'J': {"...X", "...X", "...X", "X..X", ".XX."},
	'O': {".XX.", "X..X", "X..X", "X..X", ".XX."},
	'R': {"XXX.", "X..X", "XXX.", "X.X.", "X..X"},
	'F': {"XXXX", "X...", "XXX.", "X...", "X..."},
	'L': {"X...", "X...", "X...", "X...", "XXXX"},
	'Y': {"X...X", ".X.X.", "..X..", "..X..", "..X.."},
	'E': {"XXXX", "X...", "XXX.", "X...", "XXXX"},
}

// letterCoins: quantas moedas cada letra tem (13 no M, 7 no J...).
var letterCoins = func() map[byte]int {
	total := make(map[byte]int, len(letterRows))
	for letra, linhas := range letterRows {
		for _, linha := range linhas {
			total[letra] += strings.Count(linha, "X")
		}
	}
	return total
}()

// MaxLetterCoins: a letra com mais moedas. Limita o tamanho da lista que o app
// pode mandar ao fechar a partida.
var MaxLetterCoins = func() int {
	maior := 0
	for _, n := range letterCoins {
		maior = max(maior, n)
	}
	return maior
}()

func coinRoll(seed uint32, ordinal int) uint32 {
	return mix32(seed ^ (uint32(ordinal) * 0x9e3779b9))
}

// HasCoin diz se o obstaculo `ordinal` (1, 2, 3...) da partida tem moeda.
func HasCoin(seed uint32, ordinal, every int) bool {
	if ordinal < 1 || every < 1 {
		return false
	}
	return coinRoll(seed, ordinal)%uint32(every) == 0
}

// CoinLetterAt diz que letra o obstaculo `ordinal` traz — ou 0, se ali nao tem
// moeda. E a posicao dele entre os obstaculos com moeda da mesma fase: o
// primeiro da fase traz o M, o segundo o A, e assim por diante.
func CoinLetterAt(seed uint32, ordinal, every int) byte {
	if !HasCoin(seed, ordinal, every) {
		return 0
	}
	inicio := (ordinal - 1) / StageLength * StageLength
	antes := 0
	for o := inicio + 1; o < ordinal; o++ {
		if HasCoin(seed, o, every) {
			antes++
		}
	}
	return CoinWord[antes%len(CoinWord)]
}

// ValidCoins conta quantas das moedas informadas existiam de verdade.
//
// O app manda o numero do obstaculo uma vez para cada moeda que pegou da letra
// dele. Vale ate o total de moedas da letra: repetir alem disso nao rende nada.
// (O app de antes das letras manda cada obstaculo uma vez so — e continua
// valendo uma moeda, como sempre valeu.)
//
// A letra fica no vao do obstaculo, e o ponto so vale quando o passaro sai do
// outro lado. Por isso a letra do obstaculo seguinte ao ultimo ponto (points+1)
// ainda vale: da para pegar moedas dela e bater no cano logo depois.
func ValidCoins(seed uint32, points int, ordinals []int, every int) int {
	pegas := make(map[int]int, len(ordinals))
	for _, o := range ordinals {
		if o >= 1 && o <= points+1 {
			pegas[o]++
		}
	}
	validas := 0
	for o, n := range pegas {
		if letra := CoinLetterAt(seed, o, every); letra != 0 {
			validas += min(n, letterCoins[letra])
		}
	}
	return validas
}

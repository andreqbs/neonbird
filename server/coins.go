package main

// Onde ficam as moedas de uma partida — a mesma conta de src/game/coins.js.
//
// A semente e sorteada aqui quando a partida abre. O app decide com ela, a cada
// obstaculo, se ali tem moeda; ao fechar a partida ele manda a lista das que
// pegou (pelo numero do obstaculo), e o servidor refaz a conta para cada uma.
// Moeda que nao existia naquele obstaculo, ou que estaria depois do ponto aonde
// o jogador chegou, simplesmente nao conta.
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

// ValidCoins conta quantas das moedas informadas existiam de verdade.
//
// A moeda fica no vao do obstaculo, e o ponto so vale quando o passaro sai do
// outro lado. Por isso a moeda do obstaculo seguinte ao ultimo ponto (points+1)
// ainda vale: da para pega-la e bater no cano logo depois.
func ValidCoins(seed uint32, points int, ordinals []int, every int) int {
	vistos := make(map[int]bool, len(ordinals))
	validas := 0
	for _, o := range ordinals {
		if o < 1 || o > points+1 || vistos[o] {
			continue
		}
		vistos[o] = true
		if HasCoin(seed, o, every) {
			validas++
		}
	}
	return validas
}

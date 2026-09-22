package main

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// Os mesmos numeros estao no selftest do app (tools/selftest.js). Se a conta
// mudar de um lado so, os dois testes quebram — e e isso que protege o jogador
// de pegar uma moeda que o servidor diria que nao existia.
func TestMoedasBatemComOApp(t *testing.T) {
	esperado := map[uint32][]uint32{
		1:          {2767685996, 1136996714, 1885302839, 1460141003, 2082786835, 3876931674},
		12345:      {1868776673, 1162198605, 3936060331, 3751896808, 1195200802, 1711063604},
		2654435769: {0, 1248097530, 2307639841, 2771223418, 2311093537, 3409687398},
		4294967295: {903996321, 3101234265, 2403485737, 4133615121, 2418229727, 1440506045},
	}
	for seed, rolagens := range esperado {
		for i, quer := range rolagens {
			if veio := coinRoll(seed, i+1); veio != quer {
				t.Errorf("coinRoll(%d, %d) = %d, o app calcula %d", seed, i+1, veio, quer)
			}
		}
	}

	comMoeda := func(seed uint32) []int {
		var lista []int
		for o := 1; o <= 30; o++ {
			if HasCoin(seed, o, 3) {
				lista = append(lista, o)
			}
		}
		return lista
	}
	if veio, quer := comMoeda(12345), []int{2, 9, 10, 13, 17, 18, 19, 24, 26}; !reflect.DeepEqual(veio, quer) {
		t.Errorf("moedas da semente 12345: %v, o app ve %v", veio, quer)
	}
	if veio, quer := comMoeda(4294967295), []int{1, 2, 4, 10, 11, 12, 13, 14, 18, 20, 22, 23, 26, 28}; !reflect.DeepEqual(veio, quer) {
		t.Errorf("moedas da semente 4294967295: %v, o app ve %v", veio, quer)
	}
}

func TestUmaMoedaACadaTresObstaculos(t *testing.T) {
	const n = 30000
	com := 0
	for o := 1; o <= n; o++ {
		if HasCoin(987654321, o, 3) {
			com++
		}
	}
	if fatia := float64(com) / n; fatia < 0.31 || fatia > 0.36 {
		t.Errorf("fatia de obstaculos com moeda: %.3f, esperava perto de 1/3", fatia)
	}
}

// As letras: a mesma ordem, o mesmo recomeco a cada fase e o mesmo tamanho de
// cada uma que o app (tools/selftest.js tem os mesmos numeros).
func TestLetrasBatemComOApp(t *testing.T) {
	tamanhos := map[byte]int{'M': 13, 'A': 12, 'J': 7, 'O': 10, 'R': 12, 'F': 10, 'L': 8, 'Y': 7, 'E': 13}
	if !reflect.DeepEqual(letterCoins, tamanhos) {
		t.Errorf("moedas por letra: %v, o app desenha %v", letterCoins, tamanhos)
	}
	if MaxLetterCoins != 13 {
		t.Errorf("maior letra: %d moedas, esperava 13", MaxLetterCoins)
	}

	letras := func(de, ate int) string {
		var b strings.Builder
		for o := de; o <= ate; o++ {
			if l := CoinLetterAt(12345, o, 3); l != 0 {
				fmt.Fprintf(&b, "%d:%c ", o, l)
			}
		}
		return strings.TrimSpace(b.String())
	}
	if veio, quer := letras(1, 40), "2:M 9:A 10:J 13:O 17:R 18:F 19:L 24:Y 26:E 33:R 34:M 37:A 40:J"; veio != quer {
		t.Errorf("letras da fase 1: %s, o app ve %s", veio, quer)
	}
	// Fase nova recomeca do M.
	if veio, quer := letras(101, 125), "105:M 107:A 108:J 109:O 110:R 113:F 117:L 120:Y 122:E 124:R"; veio != quer {
		t.Errorf("letras da fase 2: %s, o app ve %s", veio, quer)
	}
}

func TestValidCoinsIgnoraMoedaInventada(t *testing.T) {
	const seed = 12345 // letras nos obstaculos 2 (M), 9 (A), 10 (J), 13 (O)...
	vinteVezes := func(o int) []int {
		lista := make([]int, 20)
		for i := range lista {
			lista[i] = o
		}
		return lista
	}

	casos := []struct {
		nome   string
		pontos int
		lista  []int
		quer   int
	}{
		{"as verdadeiras contam", 30, []int{2, 9, 10, 13}, 4},
		{"cada moeda da letra conta", 30, []int{2, 2, 2}, 3},
		{"alem do tamanho da letra nao conta", 30, vinteVezes(2), 13},
		{"a letra J tem 7", 30, vinteVezes(10), 7},
		{"obstaculo sem moeda nao conta", 30, []int{1, 3, 4}, 0},
		{"moeda alem de onde o jogador chegou nao conta", 10, []int{13}, 0},
		{"a do obstaculo em que ele bateu ainda vale", 12, []int{13}, 1},
		{"numero sem sentido nao conta", 30, []int{0, -1}, 0},
	}
	for _, c := range casos {
		if veio := ValidCoins(seed, c.pontos, c.lista, 3); veio != c.quer {
			t.Errorf("%s: %d, esperava %d", c.nome, veio, c.quer)
		}
	}
}

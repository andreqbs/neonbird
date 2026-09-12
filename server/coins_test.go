package main

import (
	"reflect"
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

func TestValidCoinsIgnoraMoedaInventada(t *testing.T) {
	const seed = 12345 // moedas nos obstaculos 2, 9, 10, 13, 17, 18, 19, 24, 26...

	casos := []struct {
		nome   string
		pontos int
		lista  []int
		quer   int
	}{
		{"as verdadeiras contam", 30, []int{2, 9, 10, 13}, 4},
		{"repetida conta uma vez", 30, []int{2, 2, 2}, 1},
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

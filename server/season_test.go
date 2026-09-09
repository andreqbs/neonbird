package main

import (
	"testing"
	"time"
)

// A regra da rodada e a unica conta deste servidor que o aplicativo REFAZ por
// conta propria (src/services/season.js). Se os dois discordarem, a tela mostra
// uma rodada e o placar entra em outra — e ninguem entende por que os pontos
// "sumiram". Por isso ela e testada sozinha, sem banco.

// utc monta um instante em hora local das rodadas (-3) e devolve em UTC.
func utc(ano int, mes time.Month, dia, hora, min int) time.Time {
	return time.Date(ano, mes, dia, hora, min, 0, 0, time.UTC).
		Add(-time.Duration(seasonTZOffsetHours) * time.Hour)
}

func TestSeasonMarcos(t *testing.T) {
	// 6 de setembro de 2026 e um domingo.
	casos := []struct {
		nome   string
		quando time.Time
		id     string
		aberta bool
	}{
		{"domingo 19h59: ainda e a rodada da semana passada, em apuracao", utc(2026, 9, 6, 19, 59), "2026-08-30", false},
		{"domingo 20h em ponto: abre a nova", utc(2026, 9, 6, 20, 0), "2026-09-06", true},
		{"quarta a tarde: no meio dela", utc(2026, 9, 9, 15, 0), "2026-09-06", true},
		{"domingo 17h59: ultimo minuto valendo", utc(2026, 9, 13, 17, 59), "2026-09-06", true},
		{"domingo 18h em ponto: fecha para apuracao", utc(2026, 9, 13, 18, 0), "2026-09-06", false},
		{"domingo 20h: comeca a seguinte", utc(2026, 9, 13, 20, 0), "2026-09-13", true},
	}

	for _, c := range casos {
		s := SeasonAt(c.quando)
		if s.ID != c.id {
			t.Errorf("%s: id %q, esperava %q", c.nome, s.ID, c.id)
		}
		if s.Open != c.aberta {
			t.Errorf("%s: aberta=%v, esperava %v", c.nome, s.Open, c.aberta)
		}
	}
}

// Oito semanas, hora a hora: todo instante cai dentro de exatamente uma rodada,
// e as rodadas se encaixam sem buraco nem sobreposicao. E o teste que pega erro
// de fuso e de virada de mes/ano sem ninguem precisar imaginar o caso.
func TestSeasonCobreTodoInstante(t *testing.T) {
	inicio := utc(2026, 12, 20, 0, 0) // pega a virada do ano no meio
	var anterior Season

	for h := 0; h < 8*7*24; h++ {
		agora := inicio.Add(time.Duration(h) * time.Hour)
		s := SeasonAt(agora)

		if agora.Before(s.StartsAt) {
			t.Fatalf("%s: caiu antes da abertura da rodada %s", agora, s.ID)
		}
		if !agora.Before(s.NextOpensAt) {
			t.Fatalf("%s: caiu depois do fim da rodada %s", agora, s.ID)
		}
		if got, want := s.EndsAt, s.StartsAt.Add(7*24*time.Hour-2*time.Hour); !got.Equal(want) {
			t.Fatalf("rodada %s: fim %s, esperava %s", s.ID, got, want)
		}
		if got, want := s.Open, agora.Before(s.EndsAt); got != want {
			t.Fatalf("%s (rodada %s): aberta=%v, esperava %v", agora, s.ID, got, want)
		}

		if anterior.ID != "" && s.ID != anterior.ID {
			// Rodada nova: tem que comecar exatamente onde a outra terminou.
			if !s.StartsAt.Equal(anterior.NextOpensAt) {
				t.Fatalf("rodada %s comeca em %s, mas a %s ia ate %s",
					s.ID, s.StartsAt, anterior.ID, anterior.NextOpensAt)
			}
		}
		anterior = s
	}
}

// O id e a data do domingo da abertura, em hora local. E ele que o aplicativo
// monta sozinho, entao o formato nao pode mudar sem mudar la tambem.
func TestSeasonIDEADataDoDomingo(t *testing.T) {
	s := SeasonAt(utc(2027, 1, 6, 12, 0)) // uma quarta-feira
	if s.ID != "2027-01-03" {
		t.Fatalf("id %q, esperava 2027-01-03", s.ID)
	}
	local := s.StartsAt.Add(time.Duration(seasonTZOffsetHours) * time.Hour)
	if local.Weekday() != time.Sunday || local.Hour() != seasonOpenHour {
		t.Fatalf("abertura em %s (%s), esperava domingo as %dh", local, local.Weekday(), seasonOpenHour)
	}
}

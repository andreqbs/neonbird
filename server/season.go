package main

import (
	"fmt"
	"time"
)

// Rodadas semanais.
//
// Uma rodada abre DOMINGO AS 20H e fecha DOMINGO SEGUINTE AS 18H. As duas horas
// que sobram sao a janela de apuracao: ninguem pontua e os totais podem ser
// conferidos antes de a rodada nova comecar.
//
// O app faz a mesma conta em src/services/season.js. O id da rodada e a DATA do
// domingo em que ela abriu, entao os dois lados chegam ao mesmo texto sem
// precisar trocar mensagem — e o cliente consegue mostrar a rodada certa mesmo
// offline.

const (
	// Fuso das rodadas: -3 = Brasilia, sem horario de verao. Fixo de proposito;
	// carregar tzdata so para isso trocaria uma conta simples por um problema de
	// imagem Docker.
	seasonTZOffsetHours = -3

	seasonOpenHour  = 20 // domingo, abre
	seasonCloseHour = 18 // domingo seguinte, fecha para apuracao
)

// Season descreve uma rodada e em que ponto dela estamos.
type Season struct {
	ID          string    `json:"id"`
	StartsAt    time.Time `json:"startsAt"`
	EndsAt      time.Time `json:"endsAt"`      // fim da pontuacao
	NextOpensAt time.Time `json:"nextOpensAt"` // abertura da proxima
	Open        bool      `json:"open"`        // aceita pontos agora?
}

// SeasonAt devolve a rodada que contem (ou acabou de conter) este instante.
//
// Na janela de apuracao a rodada devolvida ainda e a que fechou: e o que a tela
// precisa mostrar, com os numeros dela, ate a proxima abrir.
func SeasonAt(t time.Time) Season {
	local := t.UTC().Add(time.Duration(seasonTZOffsetHours) * time.Hour)

	// Domingo 20h mais recente, em hora local.
	open := time.Date(local.Year(), local.Month(), local.Day(), seasonOpenHour, 0, 0, 0, time.UTC)
	open = open.AddDate(0, 0, -int(open.Weekday())) // volta ao domingo
	if open.After(local) {
		open = open.AddDate(0, 0, -7)
	}

	end := open.AddDate(0, 0, 7).Add(-time.Duration(seasonOpenHour-seasonCloseHour) * time.Hour)
	next := open.AddDate(0, 0, 7)

	toUTC := func(x time.Time) time.Time {
		return x.Add(time.Duration(-seasonTZOffsetHours) * time.Hour)
	}

	return Season{
		ID:          fmt.Sprintf("%04d-%02d-%02d", open.Year(), int(open.Month()), open.Day()),
		StartsAt:    toUTC(open),
		EndsAt:      toUTC(end),
		NextOpensAt: toUTC(next),
		Open:        local.Before(end),
	}
}

// CurrentSeason e a rodada de agora.
func CurrentSeason() Season { return SeasonAt(time.Now()) }

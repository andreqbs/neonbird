package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// Os premios da rodada: quando ela fecha (domingo 18h), os tres primeiros do
// ranking individual ganham moedas — os valores estao em SeasonPrizes
// (catalog.go). Mudar e redeploy deste servidor, sem build nova do app.
//
// Pagar e idempotente: cada colocacao de cada rodada vira uma linha em
// `season_prizes` (chave rodada + posicao), e so quem inseriu a linha credita
// as moedas. Duas instancias, ou o mesmo laco rodando de novo, nunca pagam duas
// vezes.

const seasonPrizesEvery = 10 * time.Minute

// PaySeasonPrizes paga os premios da rodada, se ela ja fechou. Devolve quantos
// premios saíram agora.
func (s *Store) PaySeasonPrizes(ctx context.Context, season Season, prizes []int, now time.Time) (int, error) {
	if len(prizes) == 0 || now.Before(season.EndsAt) {
		return 0, nil
	}
	topo, err := s.TopPlayers(ctx, season.ID, len(prizes))
	if err != nil {
		return 0, err
	}
	pagos := 0
	for i, linha := range topo {
		if prizes[i] <= 0 {
			continue
		}
		posicao, moedas := i+1, prizes[i]
		err := s.inTx(ctx, func(tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, `
				insert into season_prizes (season_id, rank, player_id, coins)
				values ($1, $2, $3, $4) on conflict (season_id, rank) do nothing`,
				season.ID, posicao, linha.ID, moedas)
			if err != nil || tag.RowsAffected() == 0 {
				return err // ja pago antes
			}
			if err := ensureWallet(ctx, tx, linha.ID); err != nil {
				return err
			}
			pagos++
			return applyDelta(ctx, tx, linha.ID, "season_prize", fmt.Sprintf("%s#%d", season.ID, posicao), delta{coins: moedas})
		})
		if err != nil {
			return pagos, err
		}
	}
	return pagos, nil
}

// seasonPrizesLoop confere a cada 10 minutos a rodada que acabou de fechar (e a
// anterior a ela, para o caso de o servidor ter ficado fora no domingo).
func seasonPrizesLoop(ctx context.Context, store *Store, log *slog.Logger) {
	for {
		agora := time.Now()
		atual := SeasonAt(agora)
		anterior := SeasonAt(atual.StartsAt.Add(-time.Minute))
		for _, rodada := range []Season{anterior, atual} {
			n, err := store.PaySeasonPrizes(ctx, rodada, SeasonPrizes, agora)
			switch {
			case err != nil && ctx.Err() == nil:
				log.Error("premios da rodada: nao deu para pagar", "rodada", rodada.ID, "erro", err)
			case n > 0:
				log.Info("premios da rodada pagos", "rodada", rodada.ID, "premios", n)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(seasonPrizesEvery):
		}
	}
}

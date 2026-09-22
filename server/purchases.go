package main

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// O registro das compras com dinheiro (billing.go) e o passaro que cada uma deu.
//
// Uma linha por compra em `bird_purchases`, pelo token que o Google da a ela. O
// passaro entra em `owned_birds` com o mesmo token: e ele que diz, num estorno
// ou numa troca de conta, qual passaro sai de onde. Toda mudanca deixa uma linha
// no livro-razao (sem moeda nenhuma, so para ficar registrado).

// GrantBirdPurchase da o passaro de uma compra paga (o Google ja confirmou).
func (s *Store) GrantBirdPurchase(ctx context.Context, playerID, birdID, token string, compra PlayPurchase) (Wallet, error) {
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := ensureWallet(ctx, tx, playerID); err != nil {
			return err
		}

		var dono, passaro, estado string
		err := tx.QueryRow(ctx,
			`select player_id::text, bird_id, state from bird_purchases where purchase_token = $1 for update`,
			token).Scan(&dono, &passaro, &estado)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			var quando *time.Time
			if compra.PurchaseTimeMillis > 0 {
				t := time.UnixMilli(int64(compra.PurchaseTimeMillis))
				quando = &t
			}
			if _, err := tx.Exec(ctx, `
				insert into bird_purchases (purchase_token, player_id, bird_id, order_id, test, purchased_at)
				values ($1, $2, $3, $4, $5, $6)`,
				token, playerID, birdID, compra.OrderID, compra.isTest(), quando); err != nil {
				return err
			}
			if err := applyDelta(ctx, tx, playerID, "buy_bird_money", birdID, delta{}); err != nil {
				return err
			}
		case err != nil:
			return err
		case estado == "voided":
			return ruleCode(409, "purchase_voided", "esta compra foi cancelada")
		case passaro != birdID:
			return ruleCode(409, "purchase_mismatch", "esta compra é de outro pássaro")
		case dono != playerID:
			// A mesma compra vinda de outra conta: o app reinstalado (codigo de
			// jogador novo) com a mesma conta do Google. O passaro muda de conta.
			if _, err := tx.Exec(ctx,
				`update bird_purchases set player_id = $2, updated_at = now() where purchase_token = $1`,
				token, playerID); err != nil {
				return err
			}
			if err := removeBoughtBird(ctx, tx, dono, birdID, token); err != nil {
				return err
			}
			if err := applyDelta(ctx, tx, playerID, "restore_bird_money", birdID, delta{}); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `
			insert into owned_birds (player_id, bird_id, purchase_token) values ($1, $2, $3)
			on conflict (player_id, bird_id) do nothing`, playerID, birdID, token); err != nil {
			return err
		}
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return wallet, err
}

// removeBoughtBird tira da conta o passaro que veio da compra `token` — e, se
// ele estava em uso, a conta volta ao passaro de sempre.
func removeBoughtBird(ctx context.Context, tx pgx.Tx, playerID, birdID, token string) error {
	tag, err := tx.Exec(ctx,
		`delete from owned_birds where player_id = $1 and bird_id = $2 and purchase_token = $3`,
		playerID, birdID, token)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	_, err = tx.Exec(ctx,
		`update wallets set equipped_bird = $3, updated_at = now() where player_id = $1 and equipped_bird = $2`,
		playerID, birdID, DefaultBird)
	return err
}

// VoidBirdPurchases anula as compras estornadas ou canceladas no Google e tira o
// passaro delas. Devolve quantas eram deste jogo e ainda estavam valendo.
func (s *Store) VoidBirdPurchases(ctx context.Context, tokens []string) (int, error) {
	if len(tokens) == 0 {
		return 0, nil
	}
	// Da lista do Google, so interessam as compras daqui que ainda valem.
	linhas, err := s.pool.Query(ctx,
		`select purchase_token from bird_purchases where state = 'granted' and purchase_token = any($1)`, tokens)
	if err != nil {
		return 0, err
	}
	var validas []string
	for linhas.Next() {
		var t string
		if err := linhas.Scan(&t); err != nil {
			linhas.Close()
			return 0, err
		}
		validas = append(validas, t)
	}
	linhas.Close()
	if err := linhas.Err(); err != nil {
		return 0, err
	}

	anuladas := 0
	for _, token := range validas {
		err := s.inTx(ctx, func(tx pgx.Tx) error {
			var dono, passaro, estado string
			if err := tx.QueryRow(ctx,
				`select player_id::text, bird_id, state from bird_purchases where purchase_token = $1 for update`,
				token).Scan(&dono, &passaro, &estado); err != nil {
				return err
			}
			if estado != "granted" {
				return nil
			}
			if _, err := tx.Exec(ctx,
				`update bird_purchases set state = 'voided', updated_at = now() where purchase_token = $1`,
				token); err != nil {
				return err
			}
			if err := removeBoughtBird(ctx, tx, dono, passaro, token); err != nil {
				return err
			}
			return applyDelta(ctx, tx, dono, "void_bird_money", passaro, delta{})
		})
		if err != nil {
			return anuladas, err
		}
		anuladas++
	}
	return anuladas, nil
}

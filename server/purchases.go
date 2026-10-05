package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// O registro das compras com dinheiro (billing.go) e o que cada uma deu: um
// passaro ou uma skin.
//
// Uma linha por compra, pelo token que o Google da a ela — as de passaro em
// `bird_purchases`, as de skin em `skin_purchases`. O item entra na conta
// (`owned_birds`, `owned_skins`) com o mesmo token: e ele que diz, num estorno
// ou numa troca de conta, o que sai de onde. Toda mudanca deixa uma linha no
// livro-razao (sem moeda nenhuma, so para ficar registrado).

// goods: um tipo de coisa que se compra com dinheiro. Diz em que tabela moram
// as compras dele e como o item entra e sai da conta.
type goods struct {
	kind      string // "bird" | "skin" — vai no livro-razao: buy_bird_money, buy_skin_money...
	purchases string // a tabela das compras
	column    string // a coluna do item nela
	give      func(ctx context.Context, tx pgx.Tx, playerID, itemID, token string) error
	take      func(ctx context.Context, tx pgx.Tx, playerID, itemID, token string) error
}

var (
	birdGoods = goods{kind: "bird", purchases: "bird_purchases", column: "bird_id", give: giveBoughtBird, take: removeBoughtBird}
	skinGoods = goods{kind: "skin", purchases: "skin_purchases", column: "skin_id", give: giveBoughtSkin, take: removeBoughtSkin}

	allGoods = []goods{birdGoods, skinGoods}
)

// GrantPurchase da o item de uma compra paga (o Google ja confirmou).
func (s *Store) GrantPurchase(ctx context.Context, g goods, playerID, itemID, token string, compra PlayPurchase) (Wallet, error) {
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := ensureWallet(ctx, tx, playerID); err != nil {
			return err
		}

		var dono, item, estado string
		err := tx.QueryRow(ctx, fmt.Sprintf(
			`select player_id::text, %s, state from %s where purchase_token = $1 for update`, g.column, g.purchases),
			token).Scan(&dono, &item, &estado)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			var quando *time.Time
			if compra.PurchaseTimeMillis > 0 {
				t := time.UnixMilli(int64(compra.PurchaseTimeMillis))
				quando = &t
			}
			if _, err := tx.Exec(ctx, fmt.Sprintf(`
				insert into %s (purchase_token, player_id, %s, order_id, test, purchased_at)
				values ($1, $2, $3, $4, $5, $6)`, g.purchases, g.column),
				token, playerID, itemID, compra.OrderID, compra.isTest(), quando); err != nil {
				return err
			}
			if err := applyDelta(ctx, tx, playerID, "buy_"+g.kind+"_money", itemID, delta{}); err != nil {
				return err
			}
		case err != nil:
			return err
		case estado == "voided":
			return ruleCode(409, "purchase_voided", "esta compra foi cancelada")
		case item != itemID:
			return ruleCode(409, "purchase_mismatch", "esta compra é de outro produto")
		case dono != playerID:
			// A mesma compra vinda de outra conta: o app reinstalado (codigo de
			// jogador novo) com a mesma conta do Google. O item muda de conta.
			if _, err := tx.Exec(ctx, fmt.Sprintf(
				`update %s set player_id = $2, updated_at = now() where purchase_token = $1`, g.purchases),
				token, playerID); err != nil {
				return err
			}
			if err := g.take(ctx, tx, dono, itemID, token); err != nil {
				return err
			}
			if err := applyDelta(ctx, tx, playerID, "restore_"+g.kind+"_money", itemID, delta{}); err != nil {
				return err
			}
		}

		if err := g.give(ctx, tx, playerID, itemID, token); err != nil {
			return err
		}
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return wallet, err
}

func giveBoughtBird(ctx context.Context, tx pgx.Tx, playerID, birdID, token string) error {
	_, err := tx.Exec(ctx, `
		insert into owned_birds (player_id, bird_id, purchase_token) values ($1, $2, $3)
		on conflict (player_id, bird_id) do nothing`, playerID, birdID, token)
	return err
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

func giveBoughtSkin(ctx context.Context, tx pgx.Tx, playerID, skinID, token string) error {
	_, err := tx.Exec(ctx, `
		insert into owned_skins (player_id, skin_id, purchase_token) values ($1, $2, $3)
		on conflict (player_id, skin_id) do nothing`, playerID, skinID, token)
	return err
}

// removeBoughtSkin tira da conta a skin que veio da compra `token`. Se ela
// estava em uso, sai do corpo junto (a cascata de equipped_skins, schema.sql).
func removeBoughtSkin(ctx context.Context, tx pgx.Tx, playerID, skinID, token string) error {
	_, err := tx.Exec(ctx,
		`delete from owned_skins where player_id = $1 and skin_id = $2 and purchase_token = $3`,
		playerID, skinID, token)
	return err
}

// VoidPurchases anula as compras estornadas ou canceladas no Google e tira da
// conta o que elas deram. Devolve quantas eram deste jogo e ainda valiam.
func (s *Store) VoidPurchases(ctx context.Context, tokens []string) (int, error) {
	anuladas := 0
	for _, g := range allGoods {
		n, err := s.voidPurchasesOf(ctx, g, tokens)
		anuladas += n
		if err != nil {
			return anuladas, err
		}
	}
	return anuladas, nil
}

func (s *Store) voidPurchasesOf(ctx context.Context, g goods, tokens []string) (int, error) {
	if len(tokens) == 0 {
		return 0, nil
	}
	// Da lista do Google, so interessam as compras daqui que ainda valem.
	linhas, err := s.pool.Query(ctx, fmt.Sprintf(
		`select purchase_token from %s where state = 'granted' and purchase_token = any($1)`, g.purchases), tokens)
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
			var dono, item, estado string
			if err := tx.QueryRow(ctx, fmt.Sprintf(
				`select player_id::text, %s, state from %s where purchase_token = $1 for update`, g.column, g.purchases),
				token).Scan(&dono, &item, &estado); err != nil {
				return err
			}
			if estado != "granted" {
				return nil
			}
			if _, err := tx.Exec(ctx, fmt.Sprintf(
				`update %s set state = 'voided', updated_at = now() where purchase_token = $1`, g.purchases),
				token); err != nil {
				return err
			}
			if err := g.take(ctx, tx, dono, item, token); err != nil {
				return err
			}
			return applyDelta(ctx, tx, dono, "void_"+g.kind+"_money", item, delta{})
		})
		if err != nil {
			return anuladas, err
		}
		anuladas++
	}
	return anuladas, nil
}

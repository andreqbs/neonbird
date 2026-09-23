package main

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// A economia do jogo: carteira, partidas, loja e premios de anuncio.
//
// Regra de ouro: saldo so muda aqui, dentro de uma transacao que trava a linha
// da carteira, e toda mudanca deixa uma linha no livro-razao. O app nunca diz
// "agora tenho 300 moedas" — ele diz "estas foram as moedas desta partida", e
// quem confere e soma e o servidor.

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type Wallet struct {
	Coins        int      `json:"coins"`
	Lives        int      `json:"lives"`
	MaxLives     int      `json:"maxLives"`
	Shields      int      `json:"shields"`
	Continues    int      `json:"continues"`
	EquippedBird string   `json:"equippedBird"`
	OwnedBirds   []string `json:"ownedBirds"`
	// As estrelas de cada passaro que o jogador tem (catalog.go). O que nao
	// evolui aparece ja no maximo.
	BirdLevels map[string]int `json:"birdLevels"`
	// Tempo de voo somado de todas as partidas, em ms. Nao e saldo — nao se
	// gasta nem se compra —, mas mora aqui porque a Home ja busca a carteira.
	FlightMs int64 `json:"flightMs"`
}

type RunSession struct {
	ID            string    `json:"id"`
	Seed          uint32    `json:"seed"`
	CoinEvery     int       `json:"coinEvery"`
	MaxContinues  int       `json:"maxContinues"`
	ContinuesUsed int       `json:"continuesUsed"`
	StartedAt     time.Time `json:"startedAt"`
	// O passaro da partida e os poderes dele (catalog.go): e com eles que o app
	// voa, e e por eles que o fechamento e a nova chance sao conferidos.
	Bird   string  `json:"bird"`
	Powers []Power `json:"powers"`
}

// RunRules sao os limites da conferencia de uma partida (vem da configuracao).
type RunRules struct {
	MaxPoints          int
	MinSecondsPerPoint float64
	MaxDuration        time.Duration
	// EnforceIntegrity: partida que falhou na verificacao de integridade nao
	// rende nada (INTEGRITY_MODE=enforce).
	EnforceIntegrity bool
}

type FinishResult struct {
	Points     int   `json:"points"`
	Coins      int   `json:"coins"`
	StageBonus int   `json:"stageBonus"`
	Ranked     bool  `json:"ranked"`
	FlightMs   int64 `json:"flightMs"`
	// Por quanto as moedas do voo foram multiplicadas (poder do passaro); o
	// `Coins` acima ja vem multiplicado.
	CoinMultiplier int `json:"coinMultiplier"`
}

// AdViewTTL: quanto tempo um video confirmado espera o app troca-lo por premio.
const AdViewTTL = 30 * time.Minute

type delta struct{ coins, lives, shields, continues int }

func newSeed() uint32 {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand quebrado e problema de maquina, nao de pedido
	}
	return binary.BigEndian.Uint32(b[:])
}

func (s *Store) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ------------------------------------------------------------------ carteira

// ensureWallet cria a carteira na primeira vez que o jogador precisa dela, com
// o tanque de vidas cheio.
func ensureWallet(ctx context.Context, q querier, playerID string) error {
	_, err := q.Exec(ctx,
		`insert into wallets (player_id, lives) values ($1, $2) on conflict (player_id) do nothing`,
		playerID, MaxLives)
	return err
}

func scanWallet(row pgx.Row) (Wallet, error) {
	w := Wallet{MaxLives: MaxLives}
	err := row.Scan(&w.Coins, &w.Lives, &w.Shields, &w.Continues, &w.EquippedBird, &w.FlightMs)
	return w, err
}

// lockWallet trava a carteira ate o fim da transacao: e o que faz dois toques
// simultaneos em "comprar" pagarem uma vez so.
func lockWallet(ctx context.Context, tx pgx.Tx, playerID string) (Wallet, error) {
	if err := ensureWallet(ctx, tx, playerID); err != nil {
		return Wallet{}, err
	}
	return scanWallet(tx.QueryRow(ctx, `
		select coins, lives, shields, continues, equipped_bird, flight_ms
		  from wallets where player_id = $1 for update`, playerID))
}

// readWallet devolve a carteira com a lista de passaros, do jeito que a tela usa.
func readWallet(ctx context.Context, q querier, playerID string) (Wallet, error) {
	w, err := scanWallet(q.QueryRow(ctx, `
		select coins, lives, shields, continues, equipped_bird, flight_ms
		  from wallets where player_id = $1`, playerID))
	if err != nil {
		return Wallet{}, err
	}

	linhas, err := q.Query(ctx,
		`select bird_id, level from owned_birds where player_id = $1 order by acquired_at, bird_id`, playerID)
	if err != nil {
		return Wallet{}, err
	}
	defer linhas.Close()

	w.OwnedBirds = []string{DefaultBird}
	w.BirdLevels = map[string]int{}
	for linhas.Next() {
		var id string
		var nivel int
		if err := linhas.Scan(&id, &nivel); err != nil {
			return Wallet{}, err
		}
		if id != DefaultBird {
			w.OwnedBirds = append(w.OwnedBirds, id)
		}
		w.BirdLevels[id] = birdOrDefault(id).starsFor(nivel)
	}
	return w, linhas.Err()
}

func (s *Store) Wallet(ctx context.Context, playerID string) (Wallet, error) {
	if err := ensureWallet(ctx, s.pool, playerID); err != nil {
		return Wallet{}, err
	}
	return readWallet(ctx, s.pool, playerID)
}

// applyDelta muda o saldo e escreve no livro-razao, na mesma transacao. Nao
// existe um sem o outro.
func applyDelta(ctx context.Context, tx pgx.Tx, playerID, kind, ref string, d delta) error {
	if _, err := tx.Exec(ctx, `
		update wallets
		   set coins = coins + $2, lives = lives + $3, shields = shields + $4,
		       continues = continues + $5, updated_at = now()
		 where player_id = $1`,
		playerID, d.coins, d.lives, d.shields, d.continues); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		insert into ledger (player_id, kind, coins, lives, shields, continues, ref)
		values ($1, $2, $3, $4, $5, $6, $7)`,
		playerID, kind, d.coins, d.lives, d.shields, d.continues, ref)
	return err
}

// ------------------------------------------------------------------ partidas

type runRow struct {
	seed          uint32
	bird          string // o passaro registrado na abertura
	status        string
	continuesUsed int
	elapsed       float64      // segundos desde a abertura, no relogio do banco
	result        FinishResult // o que rendeu, se ja foi fechada
}

// lockRun trava a partida. Partida de outro jogador responde igual a partida
// inexistente: quem tenta adivinhar id nao descobre nada.
func lockRun(ctx context.Context, tx pgx.Tx, playerID, runID string) (runRow, error) {
	var dono string
	var seed int64
	var r runRow
	err := tx.QueryRow(ctx, `
		select player_id::text, seed, bird, status, continues_used,
		       extract(epoch from now() - started_at)::float8,
		       coalesce(points, 0), coalesce(coins, 0), coalesce(stage_bonus, 0), ranked, flight_ms
		  from game_sessions where id = $1 for update`, runID).
		Scan(&dono, &seed, &r.bird, &r.status, &r.continuesUsed, &r.elapsed,
			&r.result.Points, &r.result.Coins, &r.result.StageBonus, &r.result.Ranked, &r.result.FlightMs)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && dono != playerID) {
		return runRow{}, ruleCode(404, "run_not_found", "partida não encontrada")
	}
	if err != nil {
		return runRow{}, err
	}
	r.seed = uint32(seed)
	r.result.CoinMultiplier = birdOrDefault(r.bird).coinMultiplier()
	return r, nil
}

// openRun: a partida existe, e deste jogador, esta aberta e nao passou do prazo.
func openRun(ctx context.Context, tx pgx.Tx, playerID, runID string, rules RunRules) (runRow, error) {
	r, err := lockRun(ctx, tx, playerID, runID)
	if err != nil {
		return r, err
	}
	if r.status != "open" || (rules.MaxDuration > 0 && r.elapsed > rules.MaxDuration.Seconds()) {
		return r, ruleCode(409, "run_closed", "esta partida já foi encerrada")
	}
	return r, nil
}

func markRun(ctx context.Context, tx pgx.Tx, runID, status string) error {
	_, err := tx.Exec(ctx,
		`update game_sessions set status = $2, ended_at = now() where id = $1`, runID, status)
	return err
}

// StartRun abre uma partida: custa uma vida e sorteia a semente das moedas.
//
// A partida anterior que tenha ficado aberta vira "abandoned" e nao rende nada.
// Um jogador tem uma partida aberta por vez — sem isso daria para abrir dez e
// fechar so a que foi melhor.
//
// O passaro escolhido fica gravado na partida: os poderes dele (catalog.go)
// valem ate o fim dela, mesmo que o jogador troque de passaro no meio.
func (s *Store) StartRun(ctx context.Context, playerID string) (RunSession, Wallet, error) {
	var run RunSession
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		w, err := lockWallet(ctx, tx, playerID)
		if err != nil {
			return err
		}
		if w.Lives <= 0 {
			return ruleCode(409, "no_lives", "suas vidas acabaram")
		}

		if _, err := tx.Exec(ctx, `
			update game_sessions set status = 'abandoned', ended_at = now()
			 where player_id = $1 and status = 'open'`, playerID); err != nil {
			return err
		}

		bird := birdOrDefault(w.EquippedBird)
		// As estrelas do passaro esticam o tempo dos poderes dele (catalog.go).
		nivel, err := birdLevel(ctx, tx, playerID, bird.ID)
		if err != nil {
			return err
		}
		run = RunSession{
			ID:           newUUID(),
			Seed:         newSeed(),
			CoinEvery:    CoinEvery,
			MaxContinues: MaxContinuesPerRun + bird.extraContinues(),
			Bird:         bird.ID,
			Powers:       bird.powersAtLevel(nivel),
		}
		if err := tx.QueryRow(ctx, `
			insert into game_sessions (id, player_id, seed, bird) values ($1, $2, $3, $4)
			returning started_at`, run.ID, playerID, int64(run.Seed), bird.ID).Scan(&run.StartedAt); err != nil {
			return err
		}
		if err := applyDelta(ctx, tx, playerID, "run_start", run.ID, delta{lives: -1}); err != nil {
			return err
		}
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return run, wallet, err
}

// RunIsOpen diz se a partida existe, e deste jogador, e ainda esta aberta. O
// fechamento pergunta antes de gastar uma verificacao de integridade: repetir um
// fechamento ja gravado nao precisa passar pelo Google de novo.
func (s *Store) RunIsOpen(ctx context.Context, playerID, runID string) (bool, error) {
	var aberta bool
	err := s.pool.QueryRow(ctx, `
		select exists(select 1 from game_sessions where id = $1 and player_id = $2 and status = 'open')`,
		runID, playerID).Scan(&aberta)
	return aberta, err
}

// integrityRefusal e o que o jogador le quando a partida nao passou na
// verificacao de integridade. Sem bastidor: nem Google nem servidor.
func integrityRefusal(v IntegrityVerdict) error {
	if v.Reason == "controlling" {
		return ruleCode(422, "run_unverified",
			"Um app está controlando a tela (como os de clique automático). Desative-o para suas partidas valerem moedas e ranking.")
	}
	return ruleCode(422, "run_unverified",
		"Esta partida não pôde ser validada neste aparelho e não vale moedas nem ranking.")
}

// FinishRun fecha a partida e credita o que ela rendeu.
//
// Tres conferencias, todas com numeros DESTE servidor e nao do aparelho:
//   - o placar cabe no jogo (MaxPoints);
//   - deu tempo de fazer aquele placar: cada obstaculo leva mais de um segundo
//     para chegar ate o passaro, entao MinSecondsPerPoint e um piso folgado,
//     medido desde a abertura no relogio do banco;
//   - cada moeda existia mesmo (ValidCoins).
//
// Placar impossivel fecha a partida como "rejected": sem moeda e sem ranking.
//
// Fechar de novo uma partida ja fechada devolve o MESMO resultado, sem pagar de
// novo e sem ler o placar novo. E o que deixa o app repetir o pedido quando a
// resposta se perde no caminho — o servidor gravou, a conexao caiu antes de o
// aparelho ouvir — sem o jogador ler "partida encerrada" no lugar das moedas que
// ganhou.
//
// `flightMs` e o tempo voando de fato, medido no aparelho, que vai somando na
// carteira. Ele nao vale moeda nem ponto, entao a conferencia e so contra o
// absurdo (flightTime).
//
// `integrity` e o resultado da verificacao de integridade deste fechamento
// (integrity.go). Ele fica gravado na partida sempre; com o enforce ligado,
// partida que nao passou nao rende nada.
func (s *Store) FinishRun(ctx context.Context, playerID, runID string, points int, ordinals []int, flightMs int64, integrity IntegrityVerdict, rules RunRules, season Season) (FinishResult, Wallet, error) {
	var res FinishResult
	var wallet Wallet
	var recusa error

	err := s.inTx(ctx, func(tx pgx.Tx) error {
		r, err := lockRun(ctx, tx, playerID, runID)
		if err != nil {
			return err
		}
		switch r.status {
		case "open":
		case "finished":
			res = r.result
			wallet, err = readWallet(ctx, tx, playerID)
			return err
		case "rejected":
			return ruleCode(422, "run_rejected", "esta partida foi recusada")
		default:
			return ruleCode(409, "run_closed", "esta partida já foi encerrada")
		}

		if _, err := tx.Exec(ctx,
			`update game_sessions set integrity = $2 where id = $1`, runID, integrity.Summary()); err != nil {
			return err
		}

		// As recusas gravam o motivo na partida ANTES de responder: por isso a
		// transacao termina normalmente e o erro so sai depois do commit.
		if rules.MaxDuration > 0 && r.elapsed > rules.MaxDuration.Seconds() {
			recusa = ruleCode(409, "run_closed", "esta partida ficou aberta tempo demais")
			return markRun(ctx, tx, runID, "expired")
		}
		if points < 0 || points > rules.MaxPoints {
			recusa = ruleCode(422, "run_rejected", "placar fora do esperado")
			return markRun(ctx, tx, runID, "rejected")
		}
		if float64(points)*rules.MinSecondsPerPoint > r.elapsed {
			recusa = ruleCode(422, "run_rejected", "placar rápido demais para ser de verdade")
			return markRun(ctx, tx, runID, "rejected")
		}
		if rules.EnforceIntegrity && integrity.Blocks() {
			recusa = integrityRefusal(integrity)
			return markRun(ctx, tx, runID, "rejected")
		}

		// Moedas multiplicadas sao poder do passaro da ABERTURA da partida.
		vezes := birdOrDefault(r.bird).coinMultiplier()
		res = FinishResult{
			Points:         points,
			Coins:          ValidCoins(r.seed, points, ordinals, CoinEvery) * vezes,
			CoinMultiplier: vezes,
			StageBonus:     (points / StageLength) * StageBonus,
			// Pontos entram no ranking so com a rodada aberta. Na apuracao
			// (domingo 18h-20h) a partida ainda rende moedas, mas nao mexe no
			// placar da semana.
			Ranked:   points > 0 && season.Open,
			FlightMs: flightTime(flightMs, r.elapsed),
		}
		if _, err := tx.Exec(ctx, `
			update game_sessions
			   set status = 'finished', ended_at = now(),
			       points = $2, coins = $3, stage_bonus = $4, ranked = $5, flight_ms = $6
			 where id = $1`, runID, points, res.Coins, res.StageBonus, res.Ranked, res.FlightMs); err != nil {
			return err
		}
		if total := res.Coins + res.StageBonus; total > 0 {
			if err := applyDelta(ctx, tx, playerID, "run_coins", runID, delta{coins: total}); err != nil {
				return err
			}
		}
		if res.FlightMs > 0 {
			if _, err := tx.Exec(ctx,
				`update wallets set flight_ms = flight_ms + $2 where player_id = $1`,
				playerID, res.FlightMs); err != nil {
				return err
			}
		}
		if res.Ranked {
			if _, err := tx.Exec(ctx,
				`insert into runs (player_id, season_id, points) values ($1, $2, $3)`,
				playerID, season.ID, points); err != nil {
				return err
			}
		}

		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	if err != nil {
		return FinishResult{}, Wallet{}, err
	}
	if recusa != nil {
		return FinishResult{}, Wallet{}, recusa
	}
	return res, wallet, nil
}

// flightTime e o tempo de voo que o servidor aceita: o que o aparelho mediu,
// limitado ao tempo desde a abertura da partida — voar mais que isso nao cabe.
func flightTime(ms int64, elapsedSeconds float64) int64 {
	return max(0, min(ms, int64(elapsedSeconds*1000)))
}

// ContinueRun paga a nova chance de uma partida aberta: com uma nova chance
// guardada ("stock") ou com moedas ("coins").
//
// A de anuncio chega aqui como "stock": o app troca o video confirmado por uma
// nova chance guardada e usa essa. Um terceiro caminho para o mesmo premio so
// seria mais um lugar para a regra divergir.
func (s *Store) ContinueRun(ctx context.Context, playerID, runID, method string, rules RunRules) (int, Wallet, error) {
	var usadas int
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		r, err := openRun(ctx, tx, playerID, runID, rules)
		if err != nil {
			return err
		}
		// Uma por partida — mais as que o poder do passaro da abertura der.
		limite := MaxContinuesPerRun + birdOrDefault(r.bird).extraContinues()
		if r.continuesUsed >= limite {
			if limite > 1 {
				return ruleCode(409, "continue_limit", "as novas chances desta partida já foram usadas")
			}
			return ruleCode(409, "continue_limit", "a nova chance desta partida já foi usada")
		}
		w, err := lockWallet(ctx, tx, playerID)
		if err != nil {
			return err
		}

		var d delta
		var kind string
		switch method {
		case "stock":
			if w.Continues < 1 {
				return ruleCode(409, "no_stock", "você não tem novas chances guardadas")
			}
			d, kind = delta{continues: -1}, "use_continue"
		case "coins":
			if w.Coins < ContinuePrice {
				return ruleCode(409, "not_enough_coins", "moedas insuficientes")
			}
			d, kind = delta{coins: -ContinuePrice}, "pay_continue"
		default:
			return rule(400, "forma de pagamento desconhecida")
		}

		if _, err := tx.Exec(ctx,
			`update game_sessions set continues_used = continues_used + 1 where id = $1`, runID); err != nil {
			return err
		}
		if err := applyDelta(ctx, tx, playerID, kind, runID, d); err != nil {
			return err
		}
		usadas = r.continuesUsed + 1
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return usadas, wallet, err
}

// UseShield gasta um escudo guardado numa partida aberta.
func (s *Store) UseShield(ctx context.Context, playerID, runID string, rules RunRules) (Wallet, error) {
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := openRun(ctx, tx, playerID, runID, rules); err != nil {
			return err
		}
		w, err := lockWallet(ctx, tx, playerID)
		if err != nil {
			return err
		}
		if w.Shields < 1 {
			return ruleCode(409, "no_stock", "você não tem escudos guardados")
		}
		if err := applyDelta(ctx, tx, playerID, "use_shield", runID, delta{shields: -1}); err != nil {
			return err
		}
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return wallet, err
}

// ---------------------------------------------------------------------- loja

// Buy e a loja: passaro, escudo ou nova chance, sempre pago em moedas.
func (s *Store) Buy(ctx context.Context, playerID, item, birdID string) (Wallet, error) {
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		w, err := lockWallet(ctx, tx, playerID)
		if err != nil {
			return err
		}

		switch item {
		case "bird":
			b, ok := birdByID(birdID)
			if !ok || b.ID == DefaultBird {
				return ruleCode(404, "bird_not_found", "pássaro não encontrado")
			}
			// Passaro sem preco em moedas so se compra com dinheiro (billing.go).
			if b.Price <= 0 {
				return ruleCode(409, "coins_not_accepted", "este pássaro não se compra com moedas")
			}
			tem, err := ownsBird(ctx, tx, playerID, b.ID)
			if err != nil {
				return err
			}
			if tem {
				return ruleCode(409, "already_owned", "você já tem este pássaro")
			}
			if w.Coins < b.Price {
				return ruleCode(409, "not_enough_coins", "moedas insuficientes")
			}
			if _, err := tx.Exec(ctx,
				`insert into owned_birds (player_id, bird_id) values ($1, $2)`, playerID, b.ID); err != nil {
				return err
			}
			if err := applyDelta(ctx, tx, playerID, "buy_bird", b.ID, delta{coins: -b.Price}); err != nil {
				return err
			}

		case "shield", "continue":
			preco, guardados := ShieldPrice, w.Shields
			d := delta{coins: -ShieldPrice, shields: 1}
			if item == "continue" {
				preco, guardados = ContinuePrice, w.Continues
				d = delta{coins: -ContinuePrice, continues: 1}
			}
			if guardados >= MaxStock {
				return ruleCode(409, "stock_full", "você já tem o máximo guardado")
			}
			if w.Coins < preco {
				return ruleCode(409, "not_enough_coins", "moedas insuficientes")
			}
			if err := applyDelta(ctx, tx, playerID, "buy_"+item, "", d); err != nil {
				return err
			}

		default:
			return rule(400, "item desconhecido")
		}

		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return wallet, err
}

// birdLevel: as estrelas que este jogador tem neste passaro (0 se nao tem).
func birdLevel(ctx context.Context, q querier, playerID, birdID string) (int, error) {
	var nivel int
	err := q.QueryRow(ctx,
		`select level from owned_birds where player_id = $1 and bird_id = $2`, playerID, birdID).Scan(&nivel)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return nivel, err
}

// UpgradeBird compra a proxima estrela de um passaro: mais tempo de poder.
func (s *Store) UpgradeBird(ctx context.Context, playerID, birdID string) (Wallet, error) {
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		w, err := lockWallet(ctx, tx, playerID)
		if err != nil {
			return err
		}
		b, ok := birdByID(birdID)
		if !ok || len(b.Powers) == 0 {
			return ruleCode(404, "bird_not_found", "pássaro não encontrado")
		}
		if !b.Upgradable {
			return ruleCode(409, "not_upgradable", "este pássaro já voa no máximo")
		}

		var nivel int
		err = tx.QueryRow(ctx,
			`select level from owned_birds where player_id = $1 and bird_id = $2 for update`,
			playerID, b.ID).Scan(&nivel)
		if errors.Is(err, pgx.ErrNoRows) {
			return ruleCode(409, "not_owned", "você ainda não tem este pássaro")
		}
		if err != nil {
			return err
		}
		if nivel >= MaxBirdLevel {
			return ruleCode(409, "max_level", "este pássaro já está com as cinco estrelas")
		}
		preco := b.UpgradePrice(nivel)
		if w.Coins < preco {
			return ruleCode(409, "not_enough_coins", "moedas insuficientes")
		}

		if _, err := tx.Exec(ctx,
			`update owned_birds set level = level + 1 where player_id = $1 and bird_id = $2`,
			playerID, b.ID); err != nil {
			return err
		}
		if err := applyDelta(ctx, tx, playerID, "upgrade_bird", b.ID, delta{coins: -preco}); err != nil {
			return err
		}
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return wallet, err
}

func ownsBird(ctx context.Context, q querier, playerID, birdID string) (bool, error) {
	if birdID == DefaultBird {
		return true, nil
	}
	var tem bool
	err := q.QueryRow(ctx,
		`select exists(select 1 from owned_birds where player_id = $1 and bird_id = $2)`,
		playerID, birdID).Scan(&tem)
	return tem, err
}

// EquipBird escolhe o passaro das proximas partidas. So vale passaro comprado.
func (s *Store) EquipBird(ctx context.Context, playerID, birdID string) (Wallet, error) {
	var wallet Wallet
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockWallet(ctx, tx, playerID); err != nil {
			return err
		}
		if _, ok := birdByID(birdID); !ok {
			return ruleCode(404, "bird_not_found", "pássaro não encontrado")
		}
		tem, err := ownsBird(ctx, tx, playerID, birdID)
		if err != nil {
			return err
		}
		if !tem {
			return ruleCode(403, "not_owned", "compre este pássaro antes de usar")
		}
		if _, err := tx.Exec(ctx,
			`update wallets set equipped_bird = $2, updated_at = now() where player_id = $1`,
			playerID, birdID); err != nil {
			return err
		}
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return wallet, err
}

// ------------------------------------------------------------------ anuncios

// RecordAdView guarda um video confirmado pelo Google. Devolve false quando a
// transacao ja tinha chegado antes (o Google repete o aviso) ou quando o
// jogador nao existe.
func (s *Store) RecordAdView(ctx context.Context, playerID string, cb SSVCallback) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		insert into ad_views (transaction_id, player_id, ad_unit, reward_amount)
		select $1, $2::uuid, $3, $4
		 where exists (select 1 from players where id = $2::uuid)
		on conflict (transaction_id) do nothing`,
		cb.TransactionID, playerID, cb.AdUnit, cb.RewardAmount)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// ClaimAd troca um video confirmado pelo premio escolhido: as vidas de volta,
// um escudo guardado ou uma nova chance guardada.
//
// Sem video confirmado ainda, devolve `pendente` — o aviso do Google chega
// depois de o video fechar, e o app tenta de novo por alguns segundos.
// `devAutoVerify` (so em servidor de desenvolvimento) dispensa o aviso: com
// anuncio de teste ou simulado nao ha aviso nenhum a esperar.
func (s *Store) ClaimAd(ctx context.Context, playerID, kind string, devAutoVerify bool) (Wallet, bool, error) {
	var wallet Wallet
	pendente := false
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		w, err := lockWallet(ctx, tx, playerID)
		if err != nil {
			return err
		}

		var d delta
		switch kind {
		case "lives":
			if w.Lives >= MaxLives {
				return ruleCode(409, "lives_full", "suas vidas já estão cheias")
			}
			d = delta{lives: MaxLives - w.Lives}
		case "shield":
			if w.Shields >= MaxStock {
				return ruleCode(409, "stock_full", "você já tem o máximo guardado")
			}
			d = delta{shields: 1}
		case "continue":
			if w.Continues >= MaxStock {
				return ruleCode(409, "stock_full", "você já tem o máximo guardado")
			}
			d = delta{continues: 1}
		default:
			return rule(400, "prêmio desconhecido")
		}

		var transacao string
		err = tx.QueryRow(ctx, `
			select transaction_id from ad_views
			 where player_id = $1 and claimed_at is null
			   and verified_at > now() - make_interval(secs => $2)
			 order by verified_at
			 limit 1
			   for update skip locked`, playerID, AdViewTTL.Seconds()).Scan(&transacao)
		switch {
		case errors.Is(err, pgx.ErrNoRows) && devAutoVerify:
			transacao = "dev-" + newUUID()
			if _, err := tx.Exec(ctx,
				`insert into ad_views (transaction_id, player_id, ad_unit) values ($1, $2, 'dev')`,
				transacao, playerID); err != nil {
				return err
			}
		case errors.Is(err, pgx.ErrNoRows):
			pendente = true
			return nil
		case err != nil:
			return err
		}

		if _, err := tx.Exec(ctx,
			`update ad_views set claimed_at = now(), claimed_for = $2 where transaction_id = $1`,
			transacao, kind); err != nil {
			return err
		}
		if err := applyDelta(ctx, tx, playerID, "ad_"+kind, transacao, d); err != nil {
			return err
		}
		wallet, err = readWallet(ctx, tx, playerID)
		return err
	})
	return wallet, pendente, err
}

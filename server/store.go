package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

// Limites do jogo. Eles tambem existem na tela (LeaderboardScreen, identity.js)
// so para o dedo nao bater numa parede que o servidor ja sabia — mas quem MANDA
// e aqui: cliente da para modificar, servidor nao.
const (
	GroupMaxMembers = 8
	NameMin         = 2
	PlayerNameMax   = 18
	GroupNameMax    = 24
)

// ruleError e um "nao pode" com o texto ja escrito para o jogador ler. O status
// vem junto porque cada regra tem o seu (401 nao e 409 nem 429), e a mensagem
// sobe inteira ate a tela.
type ruleError struct {
	Status  int
	Code    string
	Message string
}

func (e *ruleError) Error() string { return e.Message }

func rule(status int, format string, a ...any) error {
	return &ruleError{Status: status, Message: fmt.Sprintf(format, a...)}
}

// ruleCode e o mesmo "nao pode" com um codigo fixo, para o app decidir o que
// fazer sem precisar interpretar o texto — "no_lives" abre o video das vidas,
// "not_enough_coins" apaga o botao de comprar.
func ruleCode(status int, code, format string, a ...any) error {
	return &ruleError{Status: status, Code: code, Message: fmt.Sprintf(format, a...)}
}

// ------------------------------------------------------------------ modelos

type Player struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// RankRow e uma linha do ranking individual: `total` e a soma da rodada e
// `best` o melhor voo — os dois nomes que a tela ja le.
type RankRow struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Total int    `json:"total"`
	Best  int    `json:"best"`
}

type GroupRow struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Crest   string `json:"crest"`
	Leader  string `json:"leader"`
	Members int    `json:"members"`
	Total   int    `json:"total"`
}

type GroupMember struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Total  int    `json:"total"`
	Best   int    `json:"best"`
	Leader bool   `json:"leader"`
}

type Group struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Crest    string        `json:"crest"`
	LeaderID string        `json:"leaderId"`
	Total    int           `json:"total"`
	Members  []GroupMember `json:"members"`
}

type Standing struct {
	Rank    int `json:"rank"`
	Total   int `json:"total"`
	Best    int `json:"best"`
	Players int `json:"players"`
}

// --------------------------------------------------------------- utilidades

var (
	uuidRe   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	spacesRe = regexp.MustCompile(`\s+`)
)

// normalizeUUID aceita o codigo do jogador em qualquer caixa e recusa o que nao
// tem o formato. Recusar aqui vale a pena: codigo digitado errado vira "codigo
// invalido" em vez de um erro do Postgres.
func normalizeUUID(raw string) (string, bool) {
	s := strings.ToLower(strings.TrimSpace(raw))
	return s, uuidRe.MatchString(s)
}

func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand quebrado e problema de maquina, nao de pedido
	}
	b[6] = (b[6] & 0x0f) | 0x40 // versao 4
	b[8] = (b[8] & 0x3f) | 0x80 // variante
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// sanitizeName limpa o que veio do aplicativo: tira caractere de controle, junta
// espacos e corta por RUNAS, nao por bytes — um nome com acento nao pode virar
// lixo pela metade.
func sanitizeName(raw string, max int) (string, bool) {
	limpo := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, raw)

	limpo = strings.TrimSpace(spacesRe.ReplaceAllString(limpo, " "))
	if runas := []rune(limpo); len(runas) > max {
		limpo = strings.TrimSpace(string(runas[:max]))
	}
	if utf8.RuneCountInString(limpo) < NameMin {
		return "", false
	}
	return limpo, true
}

// O segredo do jogador e guardado como hash. Um vazamento do banco nao entrega
// o direito de pontuar no nome de ninguem.
func hashSecret(secret string) []byte {
	soma := sha256.Sum256([]byte(secret))
	return soma[:]
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ------------------------------------------------------------------ conexao

type Store struct{ pool *pgxpool.Pool }

func OpenStore(ctx context.Context, url string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL invalida: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MaxConnLifetime = time.Hour

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Migrate roda o schema embutido. Idempotente de proposito: subir de novo, ou
// subir duas instancias ao mesmo tempo, nao apaga nem duplica nada.
func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, schemaSQL)
	return err
}

// -------------------------------------------------------------------- conta

// RegisterPlayer grava o jogador novo ou atualiza o apelido de um ja conhecido.
//
// O `where` do upsert e a fechadura: se o codigo ja existe com OUTRO segredo, o
// update nao acontece e nao volta linha nenhuma. Saber o codigo de alguem — e
// ele e publico, o jogador manda por WhatsApp — nao da para tomar o lugar dela.
func (s *Store) RegisterPlayer(ctx context.Context, id, secret, name string) (Player, error) {
	var out Player
	err := s.pool.QueryRow(ctx, `
		insert into players (id, secret_hash, name)
		values ($1, $2, $3)
		on conflict (id) do update
		   set name = excluded.name, seen_at = now()
		 where players.secret_hash = excluded.secret_hash
		returning id::text, name`,
		id, hashSecret(secret), name).Scan(&out.ID, &out.Name)

	if errors.Is(err, pgx.ErrNoRows) {
		return Player{}, rule(401, "este código já pertence a outro aparelho")
	}
	if err != nil {
		return Player{}, err
	}
	return out, nil
}

// Authenticate confere o par (codigo, segredo) em toda chamada que escreve.
func (s *Store) Authenticate(ctx context.Context, id, secret string) (Player, error) {
	var guardado []byte
	var nome string
	err := s.pool.QueryRow(ctx,
		`select secret_hash, name from players where id = $1`, id).Scan(&guardado, &nome)

	if errors.Is(err, pgx.ErrNoRows) {
		return Player{}, rule(401, "jogador desconhecido neste servidor")
	}
	if err != nil {
		return Player{}, err
	}
	if subtle.ConstantTimeCompare(guardado, hashSecret(secret)) != 1 {
		return Player{}, rule(401, "código e segredo não combinam")
	}
	return Player{ID: id, Name: nome}, nil
}

// -------------------------------------------------------------------- grupos

// CreateGroup abre um grupo com o jogador dentro, ja de coroa.
func (s *Store) CreateGroup(ctx context.Context, playerID, name string, season Season) (*Group, error) {
	if !season.Open {
		return nil, rule(409, "a rodada está em apuração; os grupos da próxima abrem domingo às 20h")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	groupID := newUUID()
	if _, err := tx.Exec(ctx,
		`insert into groups (id, season_id, name, leader_id) values ($1, $2, $3, $4)`,
		groupID, season.ID, name, playerID); err != nil {
		return nil, err
	}

	// Quem segura "um grupo por rodada" e o indice unico, nao um `if` aqui: e a
	// unica forma de dois toques no mesmo segundo nao virarem dois grupos.
	_, err = tx.Exec(ctx,
		`insert into group_members (group_id, player_id, season_id) values ($1, $2, $3)`,
		groupID, playerID, season.ID)
	if isUniqueViolation(err) {
		return nil, rule(409, "você já está em um grupo nesta rodada")
	}
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.MyGroup(ctx, playerID, season)
}

// AddMember e o convite: so o lider chama, e chama pelo codigo publico do outro.
func (s *Store) AddMember(ctx context.Context, leaderID, targetID string, season Season) (string, error) {
	if !season.Open {
		return "", rule(409, "a rodada está em apuração; ninguém mais entra em grupo nela")
	}
	if leaderID == targetID {
		return "", rule(409, "você já está no grupo")
	}

	var groupID, donoID string
	var membros int
	err := s.pool.QueryRow(ctx, `
		select g.id::text, g.leader_id::text,
		       (select count(*) from group_members where group_id = g.id)
		  from group_members m
		  join groups g on g.id = m.group_id
		 where m.player_id = $1 and m.season_id = $2`,
		leaderID, season.ID).Scan(&groupID, &donoID, &membros)

	if errors.Is(err, pgx.ErrNoRows) {
		return "", rule(409, "você ainda não tem grupo nesta rodada")
	}
	if err != nil {
		return "", err
	}
	if donoID != leaderID {
		return "", rule(403, "só o líder pode chamar gente nova")
	}
	if membros >= GroupMaxMembers {
		return "", rule(409, "o grupo já tem %d jogadores", GroupMaxMembers)
	}

	var nome string
	err = s.pool.QueryRow(ctx, `select name from players where id = $1`, targetID).Scan(&nome)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", rule(404, "não achamos ninguém com esse código")
	}
	if err != nil {
		return "", err
	}

	_, err = s.pool.Exec(ctx,
		`insert into group_members (group_id, player_id, season_id) values ($1, $2, $3)`,
		groupID, targetID, season.ID)
	if isUniqueViolation(err) {
		return "", rule(409, "%s já está em um grupo nesta rodada", nome)
	}
	if err != nil {
		return "", err
	}
	return nome, nil
}

// LeaveGroup tira o jogador do grupo.
//
// Se quem sai e o lider, a coroa passa para o membro mais antigo; se nao sobra
// ninguem, o grupo se desfaz. Grupo sem lider trava o convite para sempre, e
// grupo vazio so ocupa linha no ranking.
func (s *Store) LeaveGroup(ctx context.Context, playerID string, season Season) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var groupID, donoID string
	err = tx.QueryRow(ctx, `
		select g.id::text, g.leader_id::text
		  from group_members m
		  join groups g on g.id = m.group_id
		 where m.player_id = $1 and m.season_id = $2
		   for update of g`,
		playerID, season.ID).Scan(&groupID, &donoID)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil // ja estava fora; sair de onde nao se esta nao e erro
	}
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx,
		`delete from group_members where group_id = $1 and player_id = $2`,
		groupID, playerID); err != nil {
		return err
	}

	if donoID == playerID {
		var proximo string
		err := tx.QueryRow(ctx, `
			select player_id::text from group_members
			 where group_id = $1
			 order by joined_at asc, player_id asc limit 1`, groupID).Scan(&proximo)

		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if _, err := tx.Exec(ctx, `delete from groups where id = $1`, groupID); err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			if _, err := tx.Exec(ctx,
				`update groups set leader_id = $1 where id = $2`, proximo, groupID); err != nil {
				return err
			}
		}
	}

	return tx.Commit(ctx)
}

// MyGroup devolve o grupo do jogador nesta rodada, ou nil se ele nao tem.
func (s *Store) MyGroup(ctx context.Context, playerID string, season Season) (*Group, error) {
	var g Group
	err := s.pool.QueryRow(ctx, `
		select g.id::text, g.name, g.crest, g.leader_id::text
		  from group_members m
		  join groups g on g.id = m.group_id
		 where m.player_id = $1 and m.season_id = $2`,
		playerID, season.ID).Scan(&g.ID, &g.Name, &g.Crest, &g.LeaderID)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	linhas, err := s.pool.Query(ctx, `
		select p.id::text, p.name,
		       coalesce(sum(r.points), 0)::int as total,
		       coalesce(max(r.points), 0)::int as best,
		       (p.id = $2) as leader
		  from group_members m
		  join players p on p.id = m.player_id
		  left join runs r on r.player_id = p.id and r.season_id = m.season_id
		 where m.group_id = $1
		 group by p.id, p.name, m.joined_at
		 order by total desc, m.joined_at asc`,
		g.ID, g.LeaderID)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()

	g.Members = []GroupMember{}
	for linhas.Next() {
		var m GroupMember
		if err := linhas.Scan(&m.ID, &m.Name, &m.Total, &m.Best, &m.Leader); err != nil {
			return nil, err
		}
		g.Total += m.Total
		g.Members = append(g.Members, m)
	}
	return &g, linhas.Err()
}

// ------------------------------------------------------------------- ranking

func (s *Store) TopPlayers(ctx context.Context, seasonID string, limit int) ([]RankRow, error) {
	linhas, err := s.pool.Query(ctx, `
		select p.id::text, p.name,
		       sum(r.points)::int as total,
		       max(r.points)::int as best
		  from runs r
		  join players p on p.id = r.player_id
		 where r.season_id = $1
		 group by p.id, p.name
		 order by total desc, best desc, min(r.created_at) asc
		 limit $2`, seasonID, limit)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()

	saida := []RankRow{}
	for linhas.Next() {
		var r RankRow
		if err := linhas.Scan(&r.ID, &r.Name, &r.Total, &r.Best); err != nil {
			return nil, err
		}
		saida = append(saida, r)
	}
	return saida, linhas.Err()
}

// TopGroups soma os pontos dos membros ATUAIS do grupo na rodada. Quem sai leva
// os pontos junto — e o que faz o total do grupo bater com a lista de nomes que
// aparece logo acima dele na tela.
func (s *Store) TopGroups(ctx context.Context, seasonID string, limit int) ([]GroupRow, error) {
	linhas, err := s.pool.Query(ctx, `
		select g.id::text, g.name, g.crest, l.name as leader,
		       count(distinct m.player_id)::int as members,
		       coalesce(sum(r.points), 0)::int as total
		  from groups g
		  join players l on l.id = g.leader_id
		  join group_members m on m.group_id = g.id
		  left join runs r on r.player_id = m.player_id and r.season_id = g.season_id
		 where g.season_id = $1
		 group by g.id, g.name, g.crest, l.name
		 order by total desc, members desc, g.created_at asc
		 limit $2`, seasonID, limit)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()

	saida := []GroupRow{}
	for linhas.Next() {
		var g GroupRow
		if err := linhas.Scan(&g.ID, &g.Name, &g.Crest, &g.Leader, &g.Members, &g.Total); err != nil {
			return nil, err
		}
		saida = append(saida, g)
	}
	return saida, linhas.Err()
}

// Standing e a posicao do jogador na rodada — para quem ficou fora dos 50
// primeiros saber onde caiu.
func (s *Store) Standing(ctx context.Context, playerID, seasonID string) (Standing, error) {
	var st Standing
	err := s.pool.QueryRow(ctx, `
		with totais as (
		  select player_id,
		         sum(points)::int as total,
		         max(points)::int as best
		    from runs where season_id = $1 group by player_id
		), posicoes as (
		  select player_id, total, best,
		         rank() over (order by total desc)::int as posicao,
		         count(*) over ()::int as jogadores
		    from totais
		)
		select posicao, total, best, jogadores from posicoes where player_id = $2`,
		seasonID, playerID).Scan(&st.Rank, &st.Total, &st.Best, &st.Players)

	if errors.Is(err, pgx.ErrNoRows) {
		return Standing{}, nil // ainda nao jogou nesta rodada
	}
	return st, err
}

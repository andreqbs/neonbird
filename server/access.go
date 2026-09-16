package main

import (
	"context"
	"log/slog"
	"net/netip"
	"sync"
	"time"
)

// O registro de acesso: de que IP cada jogador usou o jogo, e quando.
//
// Uma linha por VISITA. Pedido do mesmo jogador, vindo do mesmo IP, com menos de
// AccessVisitGap desde o anterior, estende a linha; IP novo ou pausa maior abre
// outra. Serve para validar e proteger o jogo — muitas contas no mesmo IP, um
// codigo usado de lugares demais — e e o registro de acesso a aplicacao que o
// Marco Civil da Internet (art. 15) pede: quem, de que IP, data e hora, guardado
// por 6 meses. Depois disso a linha sai do banco (purgeAccessLoop).
//
// Registrar e o de menos: se o banco falhar aqui, fica no log e o jogo segue.

const (
	// AccessVisitGap e a pausa que encerra uma visita.
	AccessVisitGap = 30 * time.Minute

	// AccessWriteEvery e de quanto em quanto tempo o mesmo jogador, no mesmo IP,
	// vai ao banco. Uma partida faz varios pedidos em poucos segundos, e a hora
	// da visita nao precisa de mais precisao que isso.
	AccessWriteEvery = time.Minute
)

type accessLog struct {
	store *Store
	log   *slog.Logger
	every time.Duration

	mu      sync.Mutex
	vistos  map[string]time.Time // "jogador|ip" -> ultima ida ao banco
	limpeza time.Time
}

func newAccessLog(store *Store, log *slog.Logger, every time.Duration) *accessLog {
	return &accessLog{
		store:   store,
		log:     log,
		every:   every,
		vistos:  map[string]time.Time{},
		limpeza: time.Now(),
	}
}

// Record anota que o jogador fez um pedido deste IP. Nunca devolve erro.
func (l *accessLog) Record(ctx context.Context, playerID, rawIP string) {
	addr, err := netip.ParseAddr(rawIP)
	if err != nil {
		return // cabecalho torto, sem IP de verdade: nao ha o que registrar
	}
	ip := addr.Unmap().WithZone("").String()

	chave := playerID + "|" + ip
	if !l.due(chave, time.Now()) {
		return
	}

	// O registro vale mesmo que o aparelho desista do pedido no meio.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	if err := l.store.RecordAccess(ctx, playerID, ip, AccessVisitGap); err != nil {
		l.log.Error("nao consegui registrar o acesso", "erro", err)
		l.forget(chave) // tenta de novo no proximo pedido
	}
}

// due diz se esta visita ja pode ir ao banco de novo, e ja marca a ida.
func (l *accessLog) due(chave string, agora time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Faxina: sem ela, cada jogador que passa fica ocupando memoria para sempre.
	if agora.Sub(l.limpeza) > 10*time.Minute {
		for k, visto := range l.vistos {
			if agora.Sub(visto) >= l.every {
				delete(l.vistos, k)
			}
		}
		l.limpeza = agora
	}

	if visto, ok := l.vistos[chave]; ok && agora.Sub(visto) < l.every {
		return false
	}
	l.vistos[chave] = agora
	return true
}

func (l *accessLog) forget(chave string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.vistos, chave)
}

// RecordAccess estende a visita aberta — mesmo jogador, mesmo IP, ultimo pedido
// ha menos de `gap` — ou abre outra.
func (s *Store) RecordAccess(ctx context.Context, playerID, ip string, gap time.Duration) error {
	_, err := s.pool.Exec(ctx, `
		with visita as (
			update player_access
			   set last_seen = now()
			 where id = (
			       select id from player_access
			        where player_id = $1 and ip = $2::inet
			          and last_seen > now() - make_interval(secs => $3)
			        order by last_seen desc
			        limit 1)
			returning id
		)
		insert into player_access (player_id, ip)
		select $1, $2::inet
		 where not exists (select 1 from visita)`,
		playerID, ip, gap.Seconds())
	return err
}

// PurgeAccess apaga as visitas que terminaram ha mais de 6 meses.
func (s *Store) PurgeAccess(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`delete from player_access where last_seen < now() - interval '6 months'`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// purgeAccessLoop apaga o registro vencido na subida e, depois, uma vez por dia.
func purgeAccessLoop(ctx context.Context, store *Store, log *slog.Logger) {
	for {
		n, err := store.PurgeAccess(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			log.Error("nao consegui apagar o registro de acesso vencido", "erro", err)
		case n > 0:
			log.Info("registro de acesso vencido apagado", "visitas", n)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(24 * time.Hour):
		}
	}
}

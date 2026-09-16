package main

import (
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// O que fica na frente de toda rota: log, socorro em caso de panico, CORS e o
// limite de pedidos. Nada aqui e especifico do jogo — e a camada que faz o
// servidor aguentar ficar exposto na internet.

// recoverPanic evita que um `nil` inesperado derrube o processo inteiro: um
// pedido quebrado vira 500 e os outros jogadores nem percebem.
func recoverPanic(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if p := recover(); p != nil {
				log.Error("panico", "path", r.URL.Path, "erro", p)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro no servidor"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func logRequests(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)

		nivel := slog.LevelInfo
		if sw.status >= 500 {
			nivel = slog.LevelError
		}
		// O codigo do jogador NAO entra no log: ele identifica a pessoa e nao
		// ajuda em nada a achar problema.
		log.Log(r.Context(), nivel, "pedido",
			"metodo", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"ms", time.Since(inicio).Milliseconds())
	})
}

// withCORS libera o navegador.
//
// O aplicativo nativo nem passa por aqui — isto e para a versao web e para
// testar com curl. `ORIGINS=*` e o padrao porque o segredo do jogador viaja em
// cabecalho, nao em cookie: nao ha sessao de navegador para roubar.
func withCORS(origins []string, next http.Handler) http.Handler {
	permitido := func(origin string) string {
		if len(origins) == 0 {
			return ""
		}
		for _, o := range origins {
			if o == "*" {
				return "*"
			}
			if strings.EqualFold(o, origin) {
				return origin
			}
		}
		return ""
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origem := permitido(r.Header.Get("Origin")); origem != "" {
			w.Header().Set("Access-Control-Allow-Origin", origem)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Player-Id, X-Player-Secret, X-Integrity-Token")
			w.Header().Set("Access-Control-Max-Age", "86400")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ------------------------------------------------------------ limite por IP

// limiter e um balde por IP: enche sozinho no tempo e esvazia a cada pedido.
//
// E na memoria de proposito. Um Redis so para isto seria mais uma peca para
// manter na VPS, e um servidor so, reiniciado de vez em quando, nao precisa
// lembrar de nada disso entre uma subida e outra.
type limiter struct {
	mu      sync.Mutex
	baldes  map[string]*balde
	taxa    float64 // fichas por segundo
	teto    float64 // quantas cabem no balde (a rajada)
	limpeza time.Time
}

type balde struct {
	fichas float64
	visto  time.Time
}

func newLimiter(porMinuto, rajada int) *limiter {
	return &limiter{
		baldes:  map[string]*balde{},
		taxa:    float64(porMinuto) / 60,
		teto:    float64(rajada),
		limpeza: time.Now(),
	}
}

func (l *limiter) allow(chave string, agora time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Faxina: quem nao aparece ha 10 minutos sai do mapa. Sem isso, cada IP que
	// passa por aqui uma vez fica ocupando memoria para sempre.
	if agora.Sub(l.limpeza) > 10*time.Minute {
		for k, b := range l.baldes {
			if agora.Sub(b.visto) > 10*time.Minute {
				delete(l.baldes, k)
			}
		}
		l.limpeza = agora
	}

	b, existe := l.baldes[chave]
	if !existe {
		b = &balde{fichas: l.teto, visto: agora}
		l.baldes[chave] = b
	}

	b.fichas += agora.Sub(b.visto).Seconds() * l.taxa
	if b.fichas > l.teto {
		b.fichas = l.teto
	}
	b.visto = agora

	if b.fichas < 1 {
		return false
	}
	b.fichas--
	return true
}

// clientIP acha quem fez o pedido.
//
// Atras de nginx/Traefik o RemoteAddr e sempre o do proxy — dai o
// X-Forwarded-For. Mas ele so vale quando ha proxy: aceitar esse cabecalho num
// servidor exposto direto seria deixar qualquer um escolher a propria chave e
// fugir do limite.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if i := strings.IndexByte(xff, ','); i >= 0 {
				xff = xff[:i]
			}
			if ip := strings.TrimSpace(xff); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func rateLimit(l *limiter, trustProxy bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// /health: o monitor do Docker bate aqui o tempo todo. /v1/ads/ssv: quem
		// chama e o Google, de poucos IPs, em nome de TODOS os jogadores — contar
		// por IP ali derrubaria premio de gente honesta. Ali a protecao e a
		// assinatura.
		if r.URL.Path == "/health" || r.URL.Path == "/v1/ads/ssv" {
			next.ServeHTTP(w, r)
			return
		}
		if !l.allow(clientIP(r, trustProxy), time.Now()) {
			w.Header().Set("Retry-After", "10")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": "muitos pedidos; tente de novo em instantes",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

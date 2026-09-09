package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Servidor do ranking do Major Flyer.
//
// Um binario, um Postgres, nada mais. Sobe com `docker compose up -d`, cabe na
// VPS mais simples e nao depende de servico de terceiro — se a internet do
// jogador cair, ou se este servidor sumir, o jogo continua inteiro no aparelho:
// recorde e historico sao locais. O online e o extra.

type Config struct {
	Port          string
	DatabaseURL   string
	Origins       []string
	TrustProxy    bool
	MaxRunPoints  int
	MinRunGap     time.Duration
	RatePerMinute int
	RateBurst     int
}

func env(chave, padrao string) string {
	if v := strings.TrimSpace(os.Getenv(chave)); v != "" {
		return v
	}
	return padrao
}

func envInt(chave string, padrao int) int {
	n, err := strconv.Atoi(env(chave, ""))
	if err != nil {
		return padrao
	}
	return n
}

func loadConfig() Config {
	origens := []string{}
	for _, o := range strings.Split(env("ALLOWED_ORIGINS", "*"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origens = append(origens, o)
		}
	}

	return Config{
		Port:        env("PORT", "8080"),
		DatabaseURL: env("DATABASE_URL", ""),
		Origins:     origens,
		TrustProxy:  env("TRUST_PROXY", "false") == "true",

		// O jogo termina na fase 5, no obstaculo 500. O teto e folgado de
		// proposito: serve para barrar o absurdo (um milhao de pontos), nao
		// para discutir o voo de ninguem.
		MaxRunPoints: envInt("MAX_RUN_POINTS", 2000),

		// Intervalo minimo entre duas partidas do MESMO jogador. Uma partida de
		// verdade leva bem mais que isso; o valor so impede o envio em rajada.
		MinRunGap: time.Duration(envInt("MIN_RUN_GAP_SECONDS", 5)) * time.Second,

		RatePerMinute: envInt("RATE_PER_MINUTE", 120),
		RateBurst:     envInt("RATE_BURST", 40),
	}
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := loadConfig()

	// `majorflyer-server healthcheck` bate no proprio /health e devolve 0 ou 1.
	// A imagem final nao tem shell nem curl (e menos coisa para dar errado num
	// servidor exposto), entao o proprio binario faz o exame do Docker.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(cfg.Port))
	}

	if cfg.DatabaseURL == "" {
		log.Error("falta DATABASE_URL (veja .env.example)")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := OpenStore(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("nao consegui abrir o banco", "erro", err)
		os.Exit(1)
	}
	defer store.Close()

	// O Postgres do compose costuma demorar alguns segundos na PRIMEIRA subida
	// (ele cria o cluster antes de aceitar conexao). Esperar aqui e melhor do
	// que o container reiniciar em loop assustando quem esta olhando o log.
	if err := waitForDB(ctx, store, 30*time.Second, log); err != nil {
		log.Error("banco nao respondeu", "erro", err)
		os.Exit(1)
	}

	if err := store.Migrate(ctx); err != nil {
		log.Error("nao consegui preparar as tabelas", "erro", err)
		os.Exit(1)
	}

	api := &API{store: store, cfg: cfg, log: log}
	limite := newLimiter(cfg.RatePerMinute, cfg.RateBurst)

	handler := recoverPanic(log,
		logRequests(log,
			withCORS(cfg.Origins,
				rateLimit(limite, cfg.TrustProxy, api.Routes()))))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		season := CurrentSeason()
		log.Info("no ar", "porta", cfg.Port, "rodada", season.ID, "aberta", season.Open)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("servidor caiu", "erro", err)
			stop()
		}
	}()

	<-ctx.Done()

	// Ctrl+C / `docker stop`: para de aceitar pedido novo e deixa o que ja esta
	// em andamento terminar. Sem isso, um deploy no meio de um envio de placar
	// perde o placar.
	log.Info("encerrando...")
	fim, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(fim); err != nil {
		log.Error("encerramento forcado", "erro", err)
	}
}

func healthcheck(porta string) int {
	cliente := http.Client{Timeout: 3 * time.Second}
	res, err := cliente.Get("http://127.0.0.1:" + porta + "/health")
	if err != nil {
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func waitForDB(ctx context.Context, store *Store, limite time.Duration, log *slog.Logger) error {
	prazo := time.Now().Add(limite)
	var ultimo error
	for {
		if err := store.Ping(ctx); err == nil {
			return nil
		} else {
			ultimo = err
		}
		if time.Now().After(prazo) || ctx.Err() != nil {
			return ultimo
		}
		log.Info("esperando o banco...")
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

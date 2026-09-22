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

// Servidor do Major Flyer: conta, economia, grupos e ranking.
//
// Um binario, um Postgres, nada mais. Sobe com `docker compose up -d` e cabe na
// VPS mais simples. Sem ele (ou sem internet) o jogo ainda abre, no modo treino:
// da para voar, mas moeda, vida, loja e ranking so existem aqui.

type Config struct {
	Port        string
	DatabaseURL string
	Origins     []string
	TrustProxy  bool

	MaxRunPoints       int
	MinSecondsPerPoint float64
	MaxRunDuration     time.Duration

	AdsDevAutoVerify bool
	AdmobKeysURL     string

	IntegrityMode        string
	PlayIntegrityPackage string
	PlayIntegrityURL     string
	PlayBillingURL       string
	GoogleServiceAccount string

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

func envFloat(chave string, padrao float64) float64 {
	n, err := strconv.ParseFloat(env(chave, ""), 64)
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

		// Piso de tempo por ponto. No celular, em retrato, um obstaculo leva
		// ~2,1 s para chegar ao passaro na fase 1 e ~1,3 s na fase 5 — e o relogio
		// ainda conta espera, pausa e paineis. 1 s nunca alcanca um jogador de
		// verdade e barra quem fecha a partida mais rapido do que o jogo permite.
		MinSecondsPerPoint: envFloat("MIN_SECONDS_PER_POINT", 1.0),

		// Partida aberta ha mais tempo que isso nao fecha mais.
		MaxRunDuration: time.Duration(envInt("MAX_RUN_MINUTES", 180)) * time.Minute,

		// SO para servidor de desenvolvimento: aceita o premio do anuncio sem o
		// aviso do Google. Anuncio de teste e anuncio simulado nao geram aviso,
		// entao sem isto nao da para testar o fluxo no `expo start`. Ligado em
		// producao, qualquer um ganha premio sem assistir nada.
		AdsDevAutoVerify: env("ADS_DEV_AUTOVERIFY", "false") == "true",
		AdmobKeysURL:     env("ADMOB_KEYS_URL", DefaultAdmobKeysURL),

		// Verificacao de integridade das partidas (integrity.go): off, log ou
		// enforce. Ligada, precisa da chave da conta de servico do Google Cloud.
		IntegrityMode:        env("INTEGRITY_MODE", IntegrityOff),
		PlayIntegrityPackage: env("PLAY_INTEGRITY_PACKAGE", DefaultPlayIntegrityPackage),
		PlayIntegrityURL:     env("PLAY_INTEGRITY_URL", DefaultPlayIntegrityURL),
		// Compra com dinheiro (billing.go): liga sozinha quando a conta de
		// servico existe. So os testes trocam o endereco.
		PlayBillingURL:       env("PLAY_BILLING_URL", DefaultPlayBillingURL),
		GoogleServiceAccount: env("GOOGLE_SERVICE_ACCOUNT", ""),

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

	if cfg.AdsDevAutoVerify {
		log.Warn("ADS_DEV_AUTOVERIFY ligado: premios de anuncio saem SEM o aviso do Google. " +
			"Isto e so para desenvolvimento — nunca deixe ligado no servidor do app publicado.")
	}

	integrity, err := NewIntegrityVerifier(cfg)
	if err != nil {
		log.Error("verificacao de integridade mal configurada (INTEGRITY_MODE / GOOGLE_SERVICE_ACCOUNT)", "erro", err)
		os.Exit(1)
	}
	switch integrity.Mode() {
	case IntegrityOff:
		log.Warn("INTEGRITY_MODE=off: partidas fecham sem verificacao de integridade do Google Play")
	default:
		log.Info("verificacao de integridade ligada", "modo", integrity.Mode(), "pacote", cfg.PlayIntegrityPackage)
	}

	billing, err := NewPlayBilling(cfg)
	if err != nil {
		log.Error("compra com dinheiro mal configurada (GOOGLE_SERVICE_ACCOUNT)", "erro", err)
		os.Exit(1)
	}
	if billing.Enabled() {
		log.Info("compra com dinheiro ligada (Google Play)", "pacote", cfg.PlayIntegrityPackage)
	} else {
		log.Warn("sem GOOGLE_SERVICE_ACCOUNT: os passaros so se compram com moedas")
	}

	api := &API{
		store:     store,
		cfg:       cfg,
		log:       log,
		ssv:       NewSSVVerifier(cfg.AdmobKeysURL),
		integrity: integrity,
		billing:   billing,
		access:    newAccessLog(store, log, AccessWriteEvery),
	}

	// Compra estornada ou cancelada no Google: o passaro sai da conta (billing.go).
	go billingVoidedLoop(ctx, store, billing, log)

	// O registro de acesso com mais de 6 meses sai do banco (access.go).
	go purgeAccessLoop(ctx, store, log)
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
	// em andamento terminar. Sem isso, um deploy no meio do fechamento de uma
	// partida perde as moedas dela.
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

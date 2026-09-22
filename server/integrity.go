package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A verificacao de integridade (Play Integrity) das partidas que rendem algo.
//
// O app pede ao Google Play um token amarrado aos dados do fechamento
// (FinishHash) e manda junto, no cabecalho X-Integrity-Token. O servidor abre o
// token no Google (decodeIntegrityToken) e confere que:
//   - e o app original, instalado pela Play Store (PLAY_RECOGNIZED);
//   - roda num aparelho genuino, sem root nem emulador (MEETS_DEVICE_INTEGRITY);
//   - os dados sao exatamente os deste fechamento, e o token e novo;
//   - nao ha app controlando a tela — clique automatico, bot (*_CONTROLLING).
//
// INTEGRITY_MODE decide o que fazer com o resultado:
//   off      nao verifica (desenvolvimento; e o padrao)
//   log      verifica e grava na partida, mas nao barra nada
//   enforce  partida sem verificacao valida nao rende moedas, ranking nem voo
//
// So o fechamento de partida que rendeu pontos ou moedas passa por aqui. Abrir
// partida so gasta vida, a loja gasta moedas ja conferidas e o premio de video
// ja chega confirmado pelo Google (ssv.go).

const (
	IntegrityOff     = "off"
	IntegrityLog     = "log"
	IntegrityEnforce = "enforce"

	DefaultPlayIntegrityPackage = "com.aqblab.majorflyer"

	// DefaultPlayIntegrityURL e a API do Google. So os testes trocam.
	DefaultPlayIntegrityURL = "https://playintegrity.googleapis.com"

	// integrityMaxAge: token mais velho que isso nao vale. O app pede o token
	// na hora de mandar o fechamento, entao alguns minutos ja sao folga.
	integrityMaxAge = 10 * time.Minute

	// integrityCacheTTL: a repeticao do mesmo pedido (a resposta se perdeu na
	// rede) reaproveita o resultado em vez de abrir o token de novo — o Google
	// nao abre o mesmo token duas vezes, e cada abertura conta na cota do dia.
	integrityCacheTTL = 10 * time.Minute

	playIntegrityScope = "https://www.googleapis.com/auth/playintegrity"
)

// IntegrityVerdict e o resultado da verificacao de um fechamento.
type IntegrityVerdict struct {
	// ok | off (desligada) | skipped (nada a creditar) | missing (sem token)
	// | failed (o Google disse que nao) | error (problema do nosso lado)
	Status string
	// Quando nao e ok: package, hash, stale, app, device, license, controlling,
	// token — ou a mensagem do erro.
	Reason string
	// Os apps de risco que o Google viu rodando (so as categorias, como
	// KNOWN_CAPTURING). Ficam registrados mesmo quando nao barram.
	Apps []string
}

// Summary e o que fica gravado na partida (game_sessions.integrity).
func (v IntegrityVerdict) Summary() string {
	s := v.Status
	if v.Reason != "" {
		s += ":" + v.Reason
	}
	if len(v.Apps) > 0 {
		s += " " + strings.Join(v.Apps, ",")
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// Blocks diz se, com o enforce ligado, este resultado tira o que a partida rendeu.
func (v IntegrityVerdict) Blocks() bool {
	return v.Status == "missing" || v.Status == "failed"
}

// FinishHash e o resumo dos dados de um fechamento, o que amarra o token a eles:
// SHA-256, em hex, de "finish|<partida>|<pontos>|<voo em ms>|<moedas por virgula>".
// E a mesma conta de finishHash em src/services/integrity.js — os dois testes
// usam o mesmo valor de referencia.
func FinishHash(runID string, points int, flightMs int64, ordinals []int) string {
	var b strings.Builder
	b.WriteString("finish|")
	b.WriteString(runID)
	b.WriteByte('|')
	b.WriteString(strconv.Itoa(points))
	b.WriteByte('|')
	b.WriteString(strconv.FormatInt(flightMs, 10))
	b.WriteByte('|')
	for i, o := range ordinals {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.Itoa(o))
	}
	soma := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(soma[:])
}

// IntegrityVerifier fala com o Google e aplica as regras.
type IntegrityVerifier struct {
	mode    string
	pkg     string
	baseURL string
	account *serviceAccount
	client  *http.Client
	now     func() time.Time
	token   *googleToken // o acesso ao Google, reaproveitado ate vencer (google.go)

	cacheMu sync.Mutex
	cache   map[string]cachedVerdict
	limpeza time.Time
}

type cachedVerdict struct {
	verdict IntegrityVerdict
	until   time.Time
}

// NewIntegrityVerifier monta a verificacao a partir da configuracao. Modo ligado
// sem uma conta de servico valida e erro de subida — nunca um "ok" calado.
func NewIntegrityVerifier(cfg Config) (*IntegrityVerifier, error) {
	mode := strings.ToLower(strings.TrimSpace(cfg.IntegrityMode))
	if mode == "" {
		mode = IntegrityOff
	}
	switch mode {
	case IntegrityOff, IntegrityLog, IntegrityEnforce:
	default:
		return nil, fmt.Errorf("INTEGRITY_MODE desconhecido: %q (use off, log ou enforce)", cfg.IntegrityMode)
	}

	v := &IntegrityVerifier{
		mode:    mode,
		pkg:     cfg.PlayIntegrityPackage,
		baseURL: strings.TrimRight(cfg.PlayIntegrityURL, "/"),
		client:  &http.Client{Timeout: 10 * time.Second},
		now:     time.Now,
		cache:   map[string]cachedVerdict{},
	}
	if v.pkg == "" {
		v.pkg = DefaultPlayIntegrityPackage
	}
	if v.baseURL == "" {
		v.baseURL = DefaultPlayIntegrityURL
	}
	if mode == IntegrityOff {
		return v, nil
	}

	conta, err := parseServiceAccount(cfg.GoogleServiceAccount)
	if err != nil {
		return nil, fmt.Errorf("INTEGRITY_MODE=%s precisa de uma GOOGLE_SERVICE_ACCOUNT valida: %w", mode, err)
	}
	v.account = conta
	v.token = newGoogleToken(conta, playIntegrityScope, v.client, v.now)
	return v, nil
}

func (v *IntegrityVerifier) Mode() string { return v.mode }

func (v *IntegrityVerifier) Enforcing() bool { return v.mode == IntegrityEnforce }

// Check confere o token de um fechamento cujo resumo dos dados e `requestHash`.
// Problema do nosso lado (Google fora, credencial recusada) volta como Status
// "error", e quem chama decide o que fazer.
func (v *IntegrityVerifier) Check(ctx context.Context, token, requestHash string) IntegrityVerdict {
	if v.mode == IntegrityOff {
		return IntegrityVerdict{Status: "off"}
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return IntegrityVerdict{Status: "missing"}
	}

	chave := sha256.Sum256([]byte(token + "|" + requestHash))
	id := hex.EncodeToString(chave[:])
	if verdict, ok := v.cached(id); ok {
		return verdict
	}

	payload, err := v.decode(ctx, token)
	var verdict IntegrityVerdict
	switch {
	case errors.Is(err, errTokenRejected):
		verdict = IntegrityVerdict{Status: "failed", Reason: "token"}
	case err != nil:
		// Nao guarda: na proxima tentativa o Google pode ja ter voltado.
		return IntegrityVerdict{Status: "error", Reason: err.Error()}
	default:
		verdict = evaluateIntegrity(payload, v.pkg, requestHash, v.now())
	}
	v.remember(id, verdict)
	return verdict
}

// evaluateIntegrity aplica as regras ao que o Google devolveu. Fica separada da
// rede para os testes cobrirem cada recusa.
func evaluateIntegrity(p tokenPayload, pkg, requestHash string, now time.Time) IntegrityVerdict {
	apps := p.EnvironmentDetails.AppAccessRiskVerdict.AppsDetected
	recusa := func(motivo string) IntegrityVerdict {
		return IntegrityVerdict{Status: "failed", Reason: motivo, Apps: apps}
	}

	pedido := p.RequestDetails
	if pedido.RequestPackageName != pkg {
		return recusa("package")
	}
	if subtle.ConstantTimeCompare([]byte(pedido.RequestHash), []byte(requestHash)) != 1 {
		return recusa("hash")
	}
	quando := time.UnixMilli(int64(pedido.TimestampMillis))
	if now.Sub(quando) > integrityMaxAge || quando.Sub(now) > time.Minute {
		return recusa("stale")
	}
	if p.AppIntegrity.AppRecognitionVerdict != "PLAY_RECOGNIZED" {
		return recusa("app")
	}
	aparelho := p.DeviceIntegrity.DeviceRecognitionVerdict
	if !slices.Contains(aparelho, "MEETS_DEVICE_INTEGRITY") && !slices.Contains(aparelho, "MEETS_STRONG_INTEGRITY") {
		return recusa("device")
	}
	if p.AccountDetails.AppLicensingVerdict == "UNLICENSED" {
		return recusa("license")
	}
	// Capturar a tela ou sobrepor janela nao barra — e o gravador de tela de
	// quem grava o proprio jogo, o filtro de luz azul. Fica so registrado.
	// Controlar a tela barra: e o que clique automatico e bot precisam para
	// jogar sozinhos.
	for _, app := range apps {
		if strings.HasSuffix(app, "_CONTROLLING") {
			return recusa("controlling")
		}
	}
	return IntegrityVerdict{Status: "ok", Apps: apps}
}

// ------------------------------------------------------------ Google

// tokenPayload e a parte do token aberto que o servidor usa.
type tokenPayload struct {
	RequestDetails struct {
		RequestPackageName string        `json:"requestPackageName"`
		RequestHash        string        `json:"requestHash"`
		TimestampMillis    flexibleInt64 `json:"timestampMillis"`
	} `json:"requestDetails"`
	AppIntegrity struct {
		AppRecognitionVerdict string `json:"appRecognitionVerdict"`
	} `json:"appIntegrity"`
	DeviceIntegrity struct {
		DeviceRecognitionVerdict []string `json:"deviceRecognitionVerdict"`
	} `json:"deviceIntegrity"`
	AccountDetails struct {
		AppLicensingVerdict string `json:"appLicensingVerdict"`
	} `json:"accountDetails"`
	EnvironmentDetails struct {
		AppAccessRiskVerdict struct {
			AppsDetected []string `json:"appsDetected"`
		} `json:"appAccessRiskVerdict"`
	} `json:"environmentDetails"`
}

// flexibleInt64 aceita numero ou texto: as APIs do Google mandam int64 como texto.
type flexibleInt64 int64

func (n *flexibleInt64) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*n = 0
		return nil
	}
	valor, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return err
	}
	*n = flexibleInt64(valor)
	return nil
}

var errTokenRejected = errors.New("o Google recusou o token")

// decode abre o token no Google.
func (v *IntegrityVerifier) decode(ctx context.Context, token string) (tokenPayload, error) {
	bearer, err := v.token.get(ctx)
	if err != nil {
		return tokenPayload{}, fmt.Errorf("credencial do Google: %w", err)
	}

	corpo, err := json.Marshal(map[string]string{"integrity_token": token})
	if err != nil {
		return tokenPayload{}, err
	}
	endereco := v.baseURL + "/v1/" + url.PathEscape(v.pkg) + ":decodeIntegrityToken"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endereco, bytes.NewReader(corpo))
	if err != nil {
		return tokenPayload{}, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")

	res, err := v.client.Do(req)
	if err != nil {
		return tokenPayload{}, err
	}
	defer res.Body.Close()
	bruto, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))

	switch {
	case res.StatusCode == http.StatusBadRequest:
		// Token torto, vencido ou ja usado: repetir nao muda nada.
		return tokenPayload{}, errTokenRejected
	case res.StatusCode == http.StatusUnauthorized:
		v.token.forget()
		return tokenPayload{}, fmt.Errorf("decodeIntegrityToken: status %d", res.StatusCode)
	case res.StatusCode != http.StatusOK:
		return tokenPayload{}, fmt.Errorf("decodeIntegrityToken: status %d: %s", res.StatusCode, snippet(bruto))
	}

	var resposta struct {
		TokenPayloadExternal tokenPayload `json:"tokenPayloadExternal"`
	}
	if err := json.Unmarshal(bruto, &resposta); err != nil {
		return tokenPayload{}, fmt.Errorf("resposta do Google ilegivel: %w", err)
	}
	return resposta.TokenPayloadExternal, nil
}

func (v *IntegrityVerifier) cached(id string) (IntegrityVerdict, bool) {
	v.cacheMu.Lock()
	defer v.cacheMu.Unlock()
	c, ok := v.cache[id]
	if !ok || v.now().After(c.until) {
		return IntegrityVerdict{}, false
	}
	return c.verdict, true
}

func (v *IntegrityVerifier) remember(id string, verdict IntegrityVerdict) {
	v.cacheMu.Lock()
	defer v.cacheMu.Unlock()
	agora := v.now()
	// Faxina: resultado vencido sai do mapa.
	if agora.Sub(v.limpeza) > integrityCacheTTL {
		for k, c := range v.cache {
			if agora.After(c.until) {
				delete(v.cache, k)
			}
		}
		v.limpeza = agora
	}
	v.cache[id] = cachedVerdict{verdict: verdict, until: agora.Add(integrityCacheTTL)}
}

package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A verificacao de integridade sem o Google de verdade: um servidor de mentira
// faz o papel do OAuth e do decodeIntegrityToken, com uma chave RSA gerada aqui.

// ------------------------------------------------------------ Google falso

var (
	chaveDoGoogleFalso     *rsa.PrivateKey
	chaveDoGoogleFalsoOnce sync.Once
)

type googleFalso struct {
	srv   *httptest.Server
	chave *rsa.PrivateKey
	conta string // a chave JSON da conta de servico, como o Google Cloud baixa

	mu       sync.Mutex
	payloads map[string]map[string]any // token -> o que o Google devolveria
	falha    int                       // status do decode enquanto o "Google" esta fora

	tokens  atomic.Int32 // pedidos de token de acesso
	decodes atomic.Int32 // aberturas de token
}

func novoGoogleFalso(t *testing.T) *googleFalso {
	t.Helper()
	chaveDoGoogleFalsoOnce.Do(func() {
		chave, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic(err)
		}
		chaveDoGoogleFalso = chave
	})

	g := &googleFalso{chave: chaveDoGoogleFalso, payloads: map[string]map[string]any{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", g.token)
	mux.HandleFunc("POST /v1/"+DefaultPlayIntegrityPackage+":decodeIntegrityToken", g.decode)
	g.srv = httptest.NewServer(mux)
	t.Cleanup(g.srv.Close)

	pkcs8, err := x509.MarshalPKCS8PrivateKey(g.chave)
	if err != nil {
		t.Fatalf("chave: %v", err)
	}
	conta, err := json.Marshal(map[string]string{
		"type":         "service_account",
		"client_email": "majorflyer@teste.iam.gserviceaccount.com",
		"private_key":  string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8})),
		"token_uri":    g.srv.URL + "/token",
	})
	if err != nil {
		t.Fatalf("conta: %v", err)
	}
	g.conta = string(conta)
	return g
}

// config liga a verificacao no modo pedido, falando com este Google falso.
func (g *googleFalso) config(mode string) func(*Config) {
	return func(c *Config) {
		c.IntegrityMode = mode
		c.PlayIntegrityURL = g.srv.URL
		c.GoogleServiceAccount = g.conta
	}
}

func (g *googleFalso) aceita(token string, payload map[string]any) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.payloads[token] = payload
}

func (g *googleFalso) fora(status int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.falha = status
}

// token confere o JWT assinado com a chave da conta e entrega um token de acesso.
func (g *googleFalso) token(w http.ResponseWriter, r *http.Request) {
	g.tokens.Add(1)
	if err := r.ParseForm(); err != nil || r.PostForm.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
		http.Error(w, "grant_type", http.StatusBadRequest)
		return
	}
	partes := strings.Split(r.PostForm.Get("assertion"), ".")
	if len(partes) != 3 {
		http.Error(w, "jwt", http.StatusBadRequest)
		return
	}
	assinatura, err := base64.RawURLEncoding.DecodeString(partes[2])
	soma := sha256.Sum256([]byte(partes[0] + "." + partes[1]))
	if err != nil || rsa.VerifyPKCS1v15(&g.chave.PublicKey, crypto.SHA256, soma[:], assinatura) != nil {
		http.Error(w, "assinatura", http.StatusUnauthorized)
		return
	}
	bruto, _ := base64.RawURLEncoding.DecodeString(partes[1])
	var claims map[string]any
	_ = json.Unmarshal(bruto, &claims)
	if claims["scope"] != playIntegrityScope || claims["aud"] != g.srv.URL+"/token" {
		http.Error(w, "claims", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"access_token": "acesso-de-teste", "expires_in": 3600})
}

func (g *googleFalso) decode(w http.ResponseWriter, r *http.Request) {
	g.decodes.Add(1)
	if r.Header.Get("Authorization") != "Bearer acesso-de-teste" {
		http.Error(w, "sem credencial", http.StatusUnauthorized)
		return
	}
	var corpo struct {
		Token string `json:"integrity_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&corpo); err != nil {
		http.Error(w, "corpo", http.StatusBadRequest)
		return
	}

	g.mu.Lock()
	falha := g.falha
	payload, ok := g.payloads[corpo.Token]
	g.mu.Unlock()
	if falha != 0 {
		http.Error(w, "fora do ar", falha)
		return
	}
	if !ok {
		http.Error(w, "token desconhecido", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokenPayloadExternal": payload})
}

// vereditoBom e o que o Google devolve para o app original num aparelho genuino.
func vereditoBom(hash string, quando time.Time) map[string]any {
	return map[string]any{
		"requestDetails": map[string]any{
			"requestPackageName": DefaultPlayIntegrityPackage,
			"requestHash":        hash,
			"timestampMillis":    strconv.FormatInt(quando.UnixMilli(), 10),
		},
		"appIntegrity":    map[string]any{"appRecognitionVerdict": "PLAY_RECOGNIZED"},
		"deviceIntegrity": map[string]any{"deviceRecognitionVerdict": []string{"MEETS_DEVICE_INTEGRITY"}},
		"accountDetails":  map[string]any{"appLicensingVerdict": "LICENSED"},
	}
}

// ------------------------------------------------------------------ regras

func TestFinishHashBateComOApp(t *testing.T) {
	// Os mesmos valores de referencia do npm test (tools/selftest.js).
	const partida = "2f6f1c7e-3b1a-4c5d-9e8f-0a1b2c3d4e5f"
	casos := []struct {
		pontos int
		voo    int64
		moedas []int
		quer   string
	}{
		{42, 61234, []int{2, 9, 10}, "1cb58bfc45863d18bd6314559005ab077670808bcd630abdabb27c04894efbf2"},
		{7, 12000, nil, "c4d27f8e067a95fa5bd43b1c965ee67f0343a791efaf4cbb3329924e9101490d"},
	}
	for _, c := range casos {
		if got := FinishHash(partida, c.pontos, c.voo, c.moedas); got != c.quer {
			t.Errorf("FinishHash(%d, %d, %v) = %s, esperava %s", c.pontos, c.voo, c.moedas, got, c.quer)
		}
	}
}

func TestVereditoDoGoogle(t *testing.T) {
	agora := time.Now()
	const hash = "resumo-do-fechamento"
	base := func() tokenPayload {
		var p tokenPayload
		p.RequestDetails.RequestPackageName = DefaultPlayIntegrityPackage
		p.RequestDetails.RequestHash = hash
		p.RequestDetails.TimestampMillis = flexibleInt64(agora.UnixMilli())
		p.AppIntegrity.AppRecognitionVerdict = "PLAY_RECOGNIZED"
		p.DeviceIntegrity.DeviceRecognitionVerdict = []string{"MEETS_DEVICE_INTEGRITY"}
		p.AccountDetails.AppLicensingVerdict = "LICENSED"
		return p
	}

	casos := []struct {
		nome   string
		mexe   func(*tokenPayload)
		status string
		motivo string
	}{
		{"app original num aparelho genuino", func(*tokenPayload) {}, "ok", ""},
		{"gravador de tela e sobreposicao so ficam registrados", func(p *tokenPayload) {
			p.EnvironmentDetails.AppAccessRiskVerdict.AppsDetected = []string{"KNOWN_CAPTURING", "UNKNOWN_OVERLAYS"}
		}, "ok", ""},
		{"token de outro app", func(p *tokenPayload) { p.RequestDetails.RequestPackageName = "com.outro.jogo" }, "failed", "package"},
		{"token de outro fechamento", func(p *tokenPayload) { p.RequestDetails.RequestHash = "outro" }, "failed", "hash"},
		{"token velho", func(p *tokenPayload) {
			p.RequestDetails.TimestampMillis = flexibleInt64(agora.Add(-11 * time.Minute).UnixMilli())
		}, "failed", "stale"},
		{"app alterado ou fora da Play Store", func(p *tokenPayload) {
			p.AppIntegrity.AppRecognitionVerdict = "UNRECOGNIZED_VERSION"
		}, "failed", "app"},
		{"root ou emulador", func(p *tokenPayload) { p.DeviceIntegrity.DeviceRecognitionVerdict = nil }, "failed", "device"},
		{"so a integridade basica", func(p *tokenPayload) {
			p.DeviceIntegrity.DeviceRecognitionVerdict = []string{"MEETS_BASIC_INTEGRITY"}
		}, "failed", "device"},
		{"instalado por fora da loja", func(p *tokenPayload) { p.AccountDetails.AppLicensingVerdict = "UNLICENSED" }, "failed", "license"},
		{"app de clique automatico controlando a tela", func(p *tokenPayload) {
			p.EnvironmentDetails.AppAccessRiskVerdict.AppsDetected = []string{"KNOWN_INSTALLED", "UNKNOWN_CONTROLLING"}
		}, "failed", "controlling"},
	}
	for _, c := range casos {
		p := base()
		c.mexe(&p)
		v := evaluateIntegrity(p, DefaultPlayIntegrityPackage, hash, agora)
		if v.Status != c.status || v.Reason != c.motivo {
			t.Errorf("%s: deu %s:%s, esperava %s:%s", c.nome, v.Status, v.Reason, c.status, c.motivo)
		}
	}
}

func TestContaDeServicoEmJSONOuBase64(t *testing.T) {
	g := novoGoogleFalso(t)
	if _, err := parseServiceAccount(g.conta); err != nil {
		t.Errorf("chave em JSON: %v", err)
	}
	// Em base64, com quebra de linha no meio (o `base64` do Linux quebra).
	emBase64 := base64.StdEncoding.EncodeToString([]byte(g.conta))
	if _, err := parseServiceAccount(emBase64[:40] + "\n" + emBase64[40:]); err != nil {
		t.Errorf("chave em base64: %v", err)
	}
	for _, ruim := range []string{"", "nada", `{"client_email":"x@y"}`} {
		if _, err := parseServiceAccount(ruim); err == nil {
			t.Errorf("aceitou a chave invalida %q", ruim)
		}
	}

	// Ligar a verificacao sem a chave e erro de subida, e nao um "ok" calado.
	if _, err := NewIntegrityVerifier(Config{IntegrityMode: IntegrityEnforce}); err == nil {
		t.Error("enforce subiu sem conta de servico")
	}
	if _, err := NewIntegrityVerifier(Config{IntegrityMode: "talvez"}); err == nil {
		t.Error("modo desconhecido subiu")
	}
	if v, err := NewIntegrityVerifier(Config{}); err != nil || v.Mode() != IntegrityOff {
		t.Errorf("sem configuracao a verificacao fica desligada: %v", err)
	}
}

func TestVerificacaoConversaComOGoogle(t *testing.T) {
	g := novoGoogleFalso(t)
	cfg := Config{}
	g.config(IntegrityEnforce)(&cfg)
	v, err := NewIntegrityVerifier(cfg)
	if err != nil {
		t.Fatalf("verificacao: %v", err)
	}
	ctx := context.Background()

	g.aceita("token-bom", vereditoBom("hash-1", time.Now()))
	if got := v.Check(ctx, "token-bom", "hash-1"); got.Status != "ok" {
		t.Fatalf("token bom: %+v", got)
	}
	// A repeticao (a resposta do fechamento se perdeu) nao abre o token de novo.
	if got := v.Check(ctx, "token-bom", "hash-1"); got.Status != "ok" || g.decodes.Load() != 1 {
		t.Errorf("repeticao: %+v, %d aberturas", got, g.decodes.Load())
	}
	// O token de acesso do Google e reaproveitado entre as verificacoes.
	g.aceita("token-2", vereditoBom("hash-2", time.Now()))
	if got := v.Check(ctx, "token-2", "hash-2"); got.Status != "ok" || g.tokens.Load() != 1 {
		t.Errorf("segundo token: %+v, %d tokens de acesso", got, g.tokens.Load())
	}
	// O mesmo token com outros dados (placar adulterado) nao passa.
	if got := v.Check(ctx, "token-2", "hash-adulterado"); got.Status != "failed" || got.Reason != "hash" {
		t.Errorf("token de outro fechamento: %+v", got)
	}
	if got := v.Check(ctx, "", "hash-1"); got.Status != "missing" {
		t.Errorf("sem token: %+v", got)
	}
	if got := v.Check(ctx, "token-inventado", "hash-1"); got.Status != "failed" || got.Reason != "token" {
		t.Errorf("token inventado: %+v", got)
	}

	// Google fora: erro, e sem guardar — quando ele volta, a mesma conferencia passa.
	g.aceita("token-3", vereditoBom("hash-3", time.Now()))
	g.fora(http.StatusServiceUnavailable)
	if got := v.Check(ctx, "token-3", "hash-3"); got.Status != "error" {
		t.Errorf("Google fora: %+v", got)
	}
	g.fora(0)
	if got := v.Check(ctx, "token-3", "hash-3"); got.Status != "ok" {
		t.Errorf("Google de volta: %+v", got)
	}
}

// --------------------------------------------------- pela API, com o banco

// fechaComToken fecha a partida mandando a prova de integridade no cabecalho.
func (a *ambiente) fechaComToken(t *testing.T, quem jogador, id, token string, pontos int, moedas []int) (int, map[string]any) {
	t.Helper()
	corpo, err := json.Marshal(map[string]any{"points": pontos, "coinOrdinals": moedas, "flightMs": 0})
	if err != nil {
		t.Fatalf("corpo: %v", err)
	}
	req, err := http.NewRequest("POST", a.srv.URL+"/v1/runs/"+id+"/finish", bytes.NewReader(corpo))
	if err != nil {
		t.Fatalf("pedido: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Player-Id", quem.id)
	req.Header.Set("X-Player-Secret", quem.secret)
	if token != "" {
		req.Header.Set("X-Integrity-Token", token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("fechar: %v", err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (a *ambiente) integridadeDa(t *testing.T, id string) string {
	t.Helper()
	var s string
	if err := a.store.pool.QueryRow(context.Background(),
		`select integrity from game_sessions where id = $1`, id).Scan(&s); err != nil {
		t.Fatalf("integridade da partida: %v", err)
	}
	return s
}

func TestEnforceSoCreditaPartidaVerificada(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.config(IntegrityEnforce))
	ana := a.registra(t, "Ana")

	// Sem a prova: a partida fecha recusada, sem moeda nem ranking.
	id, _ := a.abrePartida(t, ana)
	st, body := a.fechaComToken(t, ana, id, "", 30, nil)
	if st != http.StatusUnprocessableEntity || codigoDe(body) != "run_unverified" {
		t.Fatalf("fechar sem prova: status %d (%v), esperava 422 run_unverified", st, body)
	}
	if got := a.integridadeDa(t, id); got != "missing" {
		t.Errorf("integridade gravada: %q, esperava missing", got)
	}

	// Com a prova certa, credita.
	id, seed := a.abrePartida(t, ana)
	moedas := moedasDe(seed, 30)
	g.aceita("token-da-ana", vereditoBom(FinishHash(id, 30, 0, moedas), time.Now()))
	st, body = a.fechaComToken(t, ana, id, "token-da-ana", 30, moedas)
	if st != http.StatusOK {
		t.Fatalf("fechar com prova: status %d (%v)", st, body)
	}
	if got := num(t, carteira(t, body)["coins"]); got != len(moedas) {
		t.Errorf("moedas: %d, esperava %d", got, len(moedas))
	}
	if got := a.integridadeDa(t, id); got != "ok" {
		t.Errorf("integridade gravada: %q, esperava ok", got)
	}

	// Repetir o fechamento (a resposta se perdeu) nao gasta outra verificacao.
	aberturas := g.decodes.Load()
	if st, body := a.fechaComToken(t, ana, id, "token-da-ana", 30, moedas); st != http.StatusOK || g.decodes.Load() != aberturas {
		t.Errorf("repeticao: status %d (%v), %d aberturas a mais", st, body, g.decodes.Load()-aberturas)
	}

	// A mesma prova com placar maior (app adulterado) nao passa.
	id, _ = a.abrePartida(t, ana)
	g.aceita("token-honesto", vereditoBom(FinishHash(id, 10, 0, nil), time.Now()))
	if st, body := a.fechaComToken(t, ana, id, "token-honesto", 99, nil); st != http.StatusUnprocessableEntity {
		t.Errorf("placar adulterado com prova de outro placar: status %d (%v)", st, body)
	}
}

func TestEnforceBarraAppControlandoATela(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.config(IntegrityEnforce))
	ana := a.registra(t, "Ana")

	id, _ := a.abrePartida(t, ana)
	veredito := vereditoBom(FinishHash(id, 12, 0, nil), time.Now())
	veredito["environmentDetails"] = map[string]any{
		"appAccessRiskVerdict": map[string]any{"appsDetected": []string{"KNOWN_CONTROLLING"}},
	}
	g.aceita("token-com-bot", veredito)

	st, body := a.fechaComToken(t, ana, id, "token-com-bot", 12, nil)
	if st != http.StatusUnprocessableEntity || !strings.Contains(erroDe(body), "clique automático") {
		t.Fatalf("app controlando a tela: status %d (%v)", st, body)
	}
	if got := a.integridadeDa(t, id); got != "failed:controlling KNOWN_CONTROLLING" {
		t.Errorf("integridade gravada: %q", got)
	}
}

func TestGoogleForaNaoFechaAPartida(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.config(IntegrityEnforce))
	ana := a.registra(t, "Ana")

	id, _ := a.abrePartida(t, ana)
	g.aceita("token", vereditoBom(FinishHash(id, 10, 0, nil), time.Now()))
	g.fora(http.StatusInternalServerError)
	st, body := a.fechaComToken(t, ana, id, "token", 10, nil)
	if st != http.StatusServiceUnavailable || codigoDe(body) != "integrity_unavailable" {
		t.Fatalf("Google fora: status %d (%v), esperava 503", st, body)
	}
	if aberta, err := a.store.RunIsOpen(context.Background(), ana.id, id); err != nil || !aberta {
		t.Fatalf("a partida deveria continuar aberta para o app tentar de novo (%v)", err)
	}

	g.fora(0)
	if st, body := a.fechaComToken(t, ana, id, "token", 10, nil); st != http.StatusOK {
		t.Errorf("Google de volta: status %d (%v)", st, body)
	}
}

func TestModoLogSoRegistra(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.config(IntegrityLog))
	ana := a.registra(t, "Ana")

	id, seed := a.abrePartida(t, ana)
	moedas := moedasDe(seed, 30)
	st, body := a.fechaComToken(t, ana, id, "", 30, moedas)
	if st != http.StatusOK {
		t.Fatalf("modo log, sem prova: status %d (%v), esperava 200", st, body)
	}
	if got := num(t, carteira(t, body)["coins"]); got != len(moedas) {
		t.Errorf("moedas: %d, esperava %d (o log nao barra)", got, len(moedas))
	}
	if got := a.integridadeDa(t, id); got != "missing" {
		t.Errorf("integridade gravada: %q, esperava missing", got)
	}
}

func TestPartidaSemNadaNaoPrecisaDeProva(t *testing.T) {
	g := novoGoogleFalso(t)
	a := novoAmbiente(t, g.config(IntegrityEnforce))
	ana := a.registra(t, "Ana")

	id, _ := a.abrePartida(t, ana)
	if st, body := a.fechaComToken(t, ana, id, "", 0, nil); st != http.StatusOK {
		t.Fatalf("partida sem pontos: status %d (%v)", st, body)
	}
	if got := a.integridadeDa(t, id); got != "skipped" {
		t.Errorf("integridade gravada: %q, esperava skipped", got)
	}
	if g.decodes.Load() != 0 {
		t.Errorf("abriu %d tokens para uma partida que nao rendeu nada", g.decodes.Load())
	}
}

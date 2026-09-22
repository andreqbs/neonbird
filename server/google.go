package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// A conversa com as APIs do Google em nome da conta de servico
// (GOOGLE_SERVICE_ACCOUNT): a verificacao de integridade (integrity.go) e as
// compras com dinheiro (billing.go) usam a mesma chave, cada uma com o seu
// escopo.

// serviceAccount e a chave JSON da conta de servico do Google Cloud.
type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
	key         *rsa.PrivateKey
}

// parseServiceAccount le a chave do jeito que o Google Cloud baixa (JSON) ou em
// base64, que e mais facil de colar numa variavel de ambiente do Dokploy.
func parseServiceAccount(raw string) (*serviceAccount, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("esta vazia")
	}
	bruto := []byte(raw)
	if !strings.HasPrefix(raw, "{") {
		decodificado, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(raw), ""))
		if err != nil {
			return nil, errors.New("nao e JSON nem base64")
		}
		bruto = decodificado
	}

	var conta serviceAccount
	if err := json.Unmarshal(bruto, &conta); err != nil {
		return nil, fmt.Errorf("JSON invalido: %w", err)
	}
	if conta.ClientEmail == "" || conta.PrivateKey == "" {
		return nil, errors.New("faltam client_email ou private_key")
	}
	if conta.TokenURI == "" {
		conta.TokenURI = "https://oauth2.googleapis.com/token"
	}

	bloco, _ := pem.Decode([]byte(conta.PrivateKey))
	if bloco == nil {
		return nil, errors.New("private_key nao esta em PEM")
	}
	chave, err := x509.ParsePKCS8PrivateKey(bloco.Bytes)
	if err != nil {
		return nil, fmt.Errorf("private_key: %w", err)
	}
	rsaKey, ok := chave.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("private_key nao e RSA")
	}
	conta.key = rsaKey
	return &conta, nil
}

// assertion e o JWT assinado com a chave da conta, trocado por um token de
// acesso com o escopo pedido.
func (c *serviceAccount) assertion(now time.Time, scope string) (string, error) {
	cabecalho := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims, err := json.Marshal(map[string]any{
		"iss":   c.ClientEmail,
		"scope": scope,
		"aud":   c.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	})
	if err != nil {
		return "", err
	}
	assinado := cabecalho + "." + base64.RawURLEncoding.EncodeToString(claims)
	soma := sha256.Sum256([]byte(assinado))
	assinatura, err := rsa.SignPKCS1v15(rand.Reader, c.key, crypto.SHA256, soma[:])
	if err != nil {
		return "", err
	}
	return assinado + "." + base64.RawURLEncoding.EncodeToString(assinatura), nil
}

// googleToken e o token de acesso de um escopo, reaproveitado ate quase vencer
// (eles duram uma hora).
type googleToken struct {
	account *serviceAccount
	scope   string
	client  *http.Client
	now     func() time.Time

	mu     sync.Mutex
	bearer string
	exp    time.Time
}

func newGoogleToken(account *serviceAccount, scope string, client *http.Client, now func() time.Time) *googleToken {
	return &googleToken{account: account, scope: scope, client: client, now: now}
}

// get devolve um token de acesso valido, pedindo outro ao Google so quando o
// atual esta para vencer.
func (g *googleToken) get(ctx context.Context) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.bearer != "" && g.now().Before(g.exp) {
		return g.bearer, nil
	}

	assertion, err := g.account.assertion(g.now(), g.scope)
	if err != nil {
		return "", err
	}
	form := url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {assertion},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.account.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := g.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	bruto, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d: %s", res.StatusCode, snippet(bruto))
	}

	var resposta struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(bruto, &resposta); err != nil || resposta.AccessToken == "" {
		return "", errors.New("resposta sem access_token")
	}
	validade := time.Duration(resposta.ExpiresIn) * time.Second
	if validade <= 2*time.Minute {
		validade = time.Hour
	}
	g.bearer = resposta.AccessToken
	g.exp = g.now().Add(validade - time.Minute)
	return g.bearer, nil
}

// forget descarta o token atual: o Google o recusou, o proximo pedido pega outro.
func (g *googleToken) forget() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.bearer = ""
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 200 {
		s = s[:200] + "..."
	}
	return s
}

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// A compra com dinheiro dos passaros da loja (Google Play Billing).
//
// O app abre a tela de pagamento do Google Play. Quando o pagamento e aprovado,
// o app manda a este servidor o TOKEN da compra, e o servidor pergunta ao
// Google, com a conta de servico (GOOGLE_SERVICE_ACCOUNT), se aquele token e
// mesmo uma compra paga daquele produto. So entao o passaro entra na conta — e
// o servidor confirma a compra no Google ("acknowledge": compra nao confirmada
// em 3 dias o Google devolve o dinheiro sozinho).
//
// A mesma compra mandada de novo devolve o mesmo resultado; mandada por OUTRA
// conta (o app reinstalado, que ganhou codigo de jogador novo), ela muda de
// conta: o passaro sai da antiga e vai para a nova. E assim que o jogador
// recupera o que pagou sem precisar de login.
//
// Estorno e cancelamento: a cada 6 horas o servidor pergunta ao Google pelas
// compras anuladas dos ultimos 30 dias (billingVoidedLoop), e o passaro
// comprado com elas sai da conta.

const (
	DefaultPlayBillingURL = "https://androidpublisher.googleapis.com"
	androidPublisherScope = "https://www.googleapis.com/auth/androidpublisher"

	billingVoidedEvery  = 6 * time.Hour
	billingVoidedWindow = 29 * 24 * time.Hour // o Google guarda 30 dias
)

// PlayBilling conversa com a Google Play Developer API.
type PlayBilling struct {
	pkg     string
	baseURL string
	client  *http.Client
	token   *googleToken // nil = compra com dinheiro desligada
}

// NewPlayBilling monta a conversa com o Google. Sem conta de servico, a compra
// com dinheiro fica desligada e a loja so vende por moedas. Conta de servico
// torta e erro de subida — nunca um "ok" calado.
func NewPlayBilling(cfg Config) (*PlayBilling, error) {
	b := &PlayBilling{
		pkg:     cfg.PlayIntegrityPackage, // o pacote do app na Play Store
		baseURL: strings.TrimRight(cfg.PlayBillingURL, "/"),
		client:  &http.Client{Timeout: 10 * time.Second},
	}
	if b.pkg == "" {
		b.pkg = DefaultPlayIntegrityPackage
	}
	if b.baseURL == "" {
		b.baseURL = DefaultPlayBillingURL
	}
	if strings.TrimSpace(cfg.GoogleServiceAccount) == "" {
		return b, nil
	}
	conta, err := parseServiceAccount(cfg.GoogleServiceAccount)
	if err != nil {
		return nil, fmt.Errorf("GOOGLE_SERVICE_ACCOUNT invalida: %w", err)
	}
	b.token = newGoogleToken(conta, androidPublisherScope, b.client, time.Now)
	return b, nil
}

func (b *PlayBilling) Enabled() bool { return b != nil && b.token != nil }

// PlayPurchase e o que o Google diz de uma compra (purchases.products.get).
type PlayPurchase struct {
	PurchaseState        int           `json:"purchaseState"`        // 0 paga, 1 cancelada, 2 pendente
	AcknowledgementState int           `json:"acknowledgementState"` // 0 falta confirmar, 1 confirmada
	OrderID              string        `json:"orderId"`
	PurchaseTimeMillis   flexibleInt64 `json:"purchaseTimeMillis"`
	// 0 = compra de teste (conta com licenca de teste no Play Console). Sem o
	// campo, e compra de verdade.
	PurchaseType *int `json:"purchaseType"`
	// O que o app amarrou na compra: o resumo do codigo do jogador.
	ObfuscatedAccountID string `json:"obfuscatedExternalAccountId"`
}

func (p PlayPurchase) isTest() bool { return p.PurchaseType != nil && *p.PurchaseType == 0 }

var errPurchaseNotFound = errors.New("o Google nao conhece esta compra")

func (b *PlayBilling) purchaseURL(productID, token string) string {
	return fmt.Sprintf("%s/androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s",
		b.baseURL, url.PathEscape(b.pkg), url.PathEscape(productID), url.PathEscape(token))
}

// Purchase pergunta ao Google pela compra `token` do produto `productID`.
func (b *PlayBilling) Purchase(ctx context.Context, productID, token string) (PlayPurchase, error) {
	var p PlayPurchase
	err := b.call(ctx, http.MethodGet, b.purchaseURL(productID, token), nil, &p)
	return p, err
}

// Acknowledge confirma a compra no Google.
func (b *PlayBilling) Acknowledge(ctx context.Context, productID, token string) error {
	return b.call(ctx, http.MethodPost, b.purchaseURL(productID, token)+":acknowledge", map[string]string{}, nil)
}

type voidedPurchase struct {
	PurchaseToken    string        `json:"purchaseToken"`
	OrderID          string        `json:"orderId"`
	VoidedTimeMillis flexibleInt64 `json:"voidedTimeMillis"`
}

// Voided lista as compras anuladas (estorno, cancelamento, chargeback) desde `since`.
func (b *PlayBilling) Voided(ctx context.Context, since time.Time) ([]voidedPurchase, error) {
	var todas []voidedPurchase
	pagina := ""
	for {
		q := url.Values{"startTime": {strconv.FormatInt(since.UnixMilli(), 10)}}
		if pagina != "" {
			q.Set("token", pagina)
		}
		var resposta struct {
			VoidedPurchases []voidedPurchase `json:"voidedPurchases"`
			TokenPagination struct {
				NextPageToken string `json:"nextPageToken"`
			} `json:"tokenPagination"`
		}
		endereco := fmt.Sprintf("%s/androidpublisher/v3/applications/%s/purchases/voidedpurchases?%s",
			b.baseURL, url.PathEscape(b.pkg), q.Encode())
		if err := b.call(ctx, http.MethodGet, endereco, nil, &resposta); err != nil {
			return nil, err
		}
		todas = append(todas, resposta.VoidedPurchases...)
		if resposta.TokenPagination.NextPageToken == "" || len(todas) > 50000 {
			return todas, nil
		}
		pagina = resposta.TokenPagination.NextPageToken
	}
}

func (b *PlayBilling) call(ctx context.Context, method, endereco string, corpo, destino any) error {
	bearer, err := b.token.get(ctx)
	if err != nil {
		return fmt.Errorf("credencial do Google: %w", err)
	}
	var body io.Reader
	if corpo != nil {
		bruto, err := json.Marshal(corpo)
		if err != nil {
			return err
		}
		body = bytes.NewReader(bruto)
	}
	req, err := http.NewRequestWithContext(ctx, method, endereco, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	if corpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	res, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	bruto, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))

	switch {
	case res.StatusCode == http.StatusBadRequest || res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone:
		// Token torto, de outro produto ou que nunca existiu.
		return errPurchaseNotFound
	case res.StatusCode == http.StatusUnauthorized:
		b.token.forget()
		return fmt.Errorf("androidpublisher: status %d", res.StatusCode)
	case res.StatusCode/100 != 2:
		// 403 aqui quase sempre e a conta de servico sem permissao no Play Console.
		return fmt.Errorf("androidpublisher: status %d: %s", res.StatusCode, snippet(bruto))
	}
	if destino != nil && len(bytes.TrimSpace(bruto)) > 0 {
		if err := json.Unmarshal(bruto, destino); err != nil {
			return fmt.Errorf("resposta do Google ilegivel: %w", err)
		}
	}
	return nil
}

// syncVoidedPurchases pergunta ao Google pelas compras anuladas dos ultimos 30
// dias e tira o passaro delas. Devolve quantas eram deste jogo e ainda valiam.
func syncVoidedPurchases(ctx context.Context, store *Store, billing *PlayBilling) (int, error) {
	lista, err := billing.Voided(ctx, time.Now().Add(-billingVoidedWindow))
	if err != nil {
		return 0, fmt.Errorf("o Google nao respondeu: %w", err)
	}
	tokens := make([]string, 0, len(lista))
	for _, v := range lista {
		tokens = append(tokens, v.PurchaseToken)
	}
	return store.VoidBirdPurchases(ctx, tokens)
}

// billingVoidedLoop confere as compras anuladas na subida e a cada 6 horas.
func billingVoidedLoop(ctx context.Context, store *Store, billing *PlayBilling, log *slog.Logger) {
	if !billing.Enabled() {
		return
	}
	confere := func() {
		c, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		n, err := syncVoidedPurchases(c, store, billing)
		if err != nil {
			log.Warn("compras anuladas: nao deu para conferir", "erro", err)
			return
		}
		if n > 0 {
			log.Info("compras anuladas: passaros retirados das contas", "quantos", n)
		}
	}

	confere()
	relogio := time.NewTicker(billingVoidedEvery)
	defer relogio.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-relogio.C:
			confere()
		}
	}
}

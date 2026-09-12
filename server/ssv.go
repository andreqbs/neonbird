package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Verificacao do video premiado pelo servidor (SSV do AdMob).
//
// Quando alguem termina um video premiado, e o GOOGLE quem chama
//
//	GET /v1/ads/ssv?...&user_id=<codigo do jogador>&transaction_id=...&signature=...&key_id=...
//
// assinando a chamada com uma chave dele. O app nao participa dessa conversa —
// e exatamente isso que impede um app modificado de dizer "assisti" sem ter
// assistido.
//
// Como conferir, segundo a documentacao do AdMob:
//   - `signature` e `key_id` sao sempre os DOIS ULTIMOS parametros, nessa ordem;
//   - o conteudo assinado e a query string CRUA, do comeco ate antes de
//     "&signature=";
//   - a assinatura e ECDSA com SHA-256, em DER, codificada em base64 web-safe;
//   - as chaves publicas ficam em verifier-keys.json: `keyId` numerico e a chave
//     (DER) em `base64`.

const DefaultAdmobKeysURL = "https://www.gstatic.com/admob/reward/verifier-keys.json"

// SSVCallback e o que interessa de uma chamada ja conferida.
type SSVCallback struct {
	UserID        string
	TransactionID string
	AdUnit        string
	RewardItem    string
	RewardAmount  int
	CustomData    string
}

var (
	errNoSignature = errors.New("chamada sem assinatura")

	// errKeysUnavailable separa "nao deu para conferir AGORA" de "a assinatura
	// esta errada". No primeiro caso o aviso tem que voltar a chegar.
	errKeysUnavailable = errors.New("chaves do AdMob indisponiveis")
)

// keyProvider devolve a chave publica de um key_id. E uma interface para os
// testes assinarem com uma chave propria, sem depender da rede.
type keyProvider interface {
	Key(ctx context.Context, id int64) (*ecdsa.PublicKey, error)
}

type SSVVerifier struct{ keys keyProvider }

func NewSSVVerifier(keysURL string) *SSVVerifier {
	if keysURL == "" {
		keysURL = DefaultAdmobKeysURL
	}
	return &SSVVerifier{keys: &googleKeys{url: keysURL, client: &http.Client{Timeout: 10 * time.Second}}}
}

// Verify confere a assinatura e devolve os campos da chamada.
func (v *SSVVerifier) Verify(ctx context.Context, rawQuery string) (SSVCallback, error) {
	i := strings.Index(rawQuery, "&signature=")
	if i < 0 {
		return SSVCallback{}, errNoSignature
	}
	conteudo := rawQuery[:i]

	valores, err := url.ParseQuery(rawQuery)
	if err != nil {
		return SSVCallback{}, fmt.Errorf("query invalida: %w", err)
	}
	keyID, err := strconv.ParseInt(valores.Get("key_id"), 10, 64)
	if err != nil {
		return SSVCallback{}, fmt.Errorf("key_id invalido: %w", err)
	}
	assinatura, err := decodeWebSafeBase64(valores.Get("signature"))
	if err != nil {
		return SSVCallback{}, fmt.Errorf("assinatura mal codificada: %w", err)
	}
	chave, err := v.keys.Key(ctx, keyID)
	if err != nil {
		return SSVCallback{}, err
	}

	soma := sha256.Sum256([]byte(conteudo))
	if !ecdsa.VerifyASN1(chave, soma[:], assinatura) {
		return SSVCallback{}, errors.New("assinatura nao confere")
	}

	quantia, _ := strconv.Atoi(valores.Get("reward_amount"))
	return SSVCallback{
		UserID:        valores.Get("user_id"),
		TransactionID: valores.Get("transaction_id"),
		AdUnit:        valores.Get("ad_unit"),
		RewardItem:    valores.Get("reward_item"),
		RewardAmount:  quantia,
		CustomData:    valores.Get("custom_data"),
	}, nil
}

// decodeWebSafeBase64 aceita a assinatura com ou sem o "=" de enchimento. Se
// algum dia ela vier no base64 comum, o "+" vira espaco no parse da query — e
// e devolvido aqui antes da segunda tentativa.
func decodeWebSafeBase64(s string) ([]byte, error) {
	s = strings.TrimRight(s, "=")
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(strings.ReplaceAll(s, " ", "+"))
}

// ------------------------------------------------------- chaves do Google

type googleKeys struct {
	url    string
	client *http.Client

	mu      sync.Mutex
	keys    map[int64]*ecdsa.PublicKey
	fetched time.Time
	tried   time.Time
}

// Key usa o cache e so vai a rede quando precisa: chaves com mais de 12 horas,
// ou um key_id que ainda nao conhecemos (o Google troca de chave de tempos em
// tempos). No maximo uma ida a rede por minuto — senao um key_id inventado
// viraria um jeito de fazer o servidor martelar o Google.
func (g *googleKeys) Key(ctx context.Context, id int64) (*ecdsa.PublicKey, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	chave, conhecida := g.keys[id]
	velhas := time.Since(g.fetched) > 12*time.Hour
	if (conhecida && !velhas) || time.Since(g.tried) < time.Minute {
		if conhecida {
			return chave, nil
		}
		if g.keys == nil {
			return nil, errKeysUnavailable // a ultima busca falhou ha menos de um minuto
		}
		return nil, fmt.Errorf("key_id %d desconhecido", id)
	}

	g.tried = time.Now()
	novas, err := g.fetch(ctx)
	if err != nil {
		if conhecida {
			return chave, nil // rede ruim agora: a chave de antes ainda serve
		}
		return nil, fmt.Errorf("%w: %v", errKeysUnavailable, err)
	}
	g.keys = novas
	g.fetched = time.Now()

	if chave, ok := novas[id]; ok {
		return chave, nil
	}
	return nil, fmt.Errorf("key_id %d desconhecido", id)
}

func (g *googleKeys) fetch(ctx context.Context) (map[int64]*ecdsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.url, nil)
	if err != nil {
		return nil, err
	}
	res, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("chaves do AdMob: status %d", res.StatusCode)
	}
	corpo, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	return parseAdmobKeys(corpo)
}

func parseAdmobKeys(corpo []byte) (map[int64]*ecdsa.PublicKey, error) {
	var doc struct {
		Keys []struct {
			KeyID  int64  `json:"keyId"`
			Base64 string `json:"base64"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(corpo, &doc); err != nil {
		return nil, err
	}

	chaves := map[int64]*ecdsa.PublicKey{}
	for _, k := range doc.Keys {
		der, err := base64.StdEncoding.DecodeString(k.Base64)
		if err != nil {
			continue
		}
		pub, err := x509.ParsePKIXPublicKey(der)
		if err != nil {
			continue
		}
		if ec, ok := pub.(*ecdsa.PublicKey); ok {
			chaves[k.KeyID] = ec
		}
	}
	if len(chaves) == 0 {
		return nil, errors.New("nenhuma chave utilizavel no arquivo do AdMob")
	}
	return chaves, nil
}

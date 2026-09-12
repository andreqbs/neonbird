package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
)

// A verificacao do anuncio e a unica porta pela qual premio entra sem o jogador
// pagar em moedas. Estes testes assinam chamadas do jeito que o Google assina —
// com uma chave gerada aqui — e conferem que so a assinatura boa passa.

type chavesFixas map[int64]*ecdsa.PublicKey

func (c chavesFixas) Key(_ context.Context, id int64) (*ecdsa.PublicKey, error) {
	if k, ok := c[id]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("key_id %d desconhecido", id)
}

func novaChave(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("gerar chave: %v", err)
	}
	return k
}

// assinaSSV monta a chamada como a documentacao do AdMob descreve: os
// parametros e, por ultimo, signature e key_id — nessa ordem.
func assinaSSV(t *testing.T, chave *ecdsa.PrivateKey, keyID int64, userID, transacao string) string {
	t.Helper()
	conteudo := "ad_network=5450213213286189855&ad_unit=1234567890&custom_data=" +
		"&reward_amount=1&reward_item=Reward&timestamp=1507770365237823" +
		"&transaction_id=" + url.QueryEscape(transacao) +
		"&user_id=" + url.QueryEscape(userID)
	soma := sha256.Sum256([]byte(conteudo))
	sig, err := ecdsa.SignASN1(rand.Reader, chave, soma[:])
	if err != nil {
		t.Fatalf("assinar: %v", err)
	}
	return conteudo + "&signature=" + base64.RawURLEncoding.EncodeToString(sig) + "&key_id=" + fmt.Sprint(keyID)
}

func TestSSVAceitaChamadaAssinadaPeloGoogle(t *testing.T) {
	chave := novaChave(t)
	v := &SSVVerifier{keys: chavesFixas{3335741209: &chave.PublicKey}}

	jogador := newUUID()
	cb, err := v.Verify(context.Background(), assinaSSV(t, chave, 3335741209, jogador, "tx-123"))
	if err != nil {
		t.Fatalf("assinatura boa recusada: %v", err)
	}
	if cb.UserID != jogador || cb.TransactionID != "tx-123" || cb.RewardAmount != 1 {
		t.Errorf("campos lidos errado: %+v", cb)
	}
}

func TestSSVRecusaChamadaAlterada(t *testing.T) {
	chave := novaChave(t)
	v := &SSVVerifier{keys: chavesFixas{7: &chave.PublicKey}}

	// Alguem intercepta um aviso verdadeiro e troca o jogador para receber o
	// premio de outro. A assinatura cobre o user_id, entao nao passa.
	original := assinaSSV(t, chave, 7, newUUID(), "tx-1")
	i := strings.Index(original, "user_id=")
	j := strings.Index(original, "&signature=")
	alterada := original[:i] + "user_id=" + newUUID() + original[j:]

	if _, err := v.Verify(context.Background(), alterada); err == nil {
		t.Fatal("chamada com user_id trocado foi aceita")
	}
}

func TestSSVRecusaAssinaturaDeOutraChave(t *testing.T) {
	doGoogle := novaChave(t)
	impostor := novaChave(t)
	v := &SSVVerifier{keys: chavesFixas{7: &doGoogle.PublicKey}}

	if _, err := v.Verify(context.Background(), assinaSSV(t, impostor, 7, newUUID(), "tx-2")); err == nil {
		t.Fatal("assinatura feita com outra chave foi aceita")
	}
}

func TestSSVRecusaChamadaSemAssinatura(t *testing.T) {
	v := &SSVVerifier{keys: chavesFixas{}}
	_, err := v.Verify(context.Background(), "user_id=abc&transaction_id=tx-3")
	if !errors.Is(err, errNoSignature) {
		t.Fatalf("esperava errNoSignature, veio %v", err)
	}
}

func TestSSVLeArquivoDeChavesDoAdMob(t *testing.T) {
	chave := novaChave(t)
	der, err := x509.MarshalPKIXPublicKey(&chave.PublicKey)
	if err != nil {
		t.Fatalf("serializar chave: %v", err)
	}
	arquivo := fmt.Sprintf(`{"keys":[{"keyId":1916455855,"pem":"-----BEGIN PUBLIC KEY-----","base64":%q}]}`,
		base64.StdEncoding.EncodeToString(der))

	chaves, err := parseAdmobKeys([]byte(arquivo))
	if err != nil {
		t.Fatalf("ler arquivo: %v", err)
	}
	lida, ok := chaves[1916455855]
	if !ok || !lida.Equal(&chave.PublicKey) {
		t.Fatal("a chave lida do arquivo nao e a mesma que foi escrita")
	}
}

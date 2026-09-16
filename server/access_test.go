package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// O registro de acesso (access.go): de que IP cada jogador usou o jogo, e
// quando — uma linha por visita.

// chamaDoIP faz o pedido como se viesse de `ip` atras do proxy, no cabecalho
// X-Forwarded-For que o Traefik preenche.
func (a *ambiente) chamaDoIP(t *testing.T, quem jogador, ip, metodo, caminho string) int {
	t.Helper()
	req, err := http.NewRequest(metodo, a.srv.URL+caminho, nil)
	if err != nil {
		t.Fatalf("montar pedido: %v", err)
	}
	req.Header.Set("X-Player-Id", quem.id)
	req.Header.Set("X-Player-Secret", quem.secret)
	req.Header.Set("X-Forwarded-For", ip)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("chamar %s %s: %v", metodo, caminho, err)
	}
	res.Body.Close()
	return res.StatusCode
}

// visitasDe lista o IP de cada visita do jogador, na ordem em que abriram.
func (a *ambiente) visitasDe(t *testing.T, quem jogador) []string {
	t.Helper()
	linhas, err := a.store.pool.Query(context.Background(),
		`select host(ip) from player_access where player_id = $1 order by id`, quem.id)
	if err != nil {
		t.Fatalf("ler visitas: %v", err)
	}
	defer linhas.Close()

	ips := []string{}
	for linhas.Next() {
		var ip string
		if err := linhas.Scan(&ip); err != nil {
			t.Fatalf("ler visita: %v", err)
		}
		ips = append(ips, ip)
	}
	if err := linhas.Err(); err != nil {
		t.Fatalf("ler visitas: %v", err)
	}
	return ips
}

func TestAcessoFicaRegistradoComOIP(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	// Pedido sem identificacao nao registra nada: nao ha de quem.
	a.chama(t, nil, "GET", "/v1/catalog", nil)

	for i := 0; i < 3; i++ {
		if st, body := a.chama(t, &ana, "GET", "/v1/me/wallet", nil); st != http.StatusOK {
			t.Fatalf("carteira: status %d (%v)", st, body)
		}
	}

	ips := a.visitasDe(t, ana)
	if len(ips) != 1 || ips[0] != "127.0.0.1" {
		t.Fatalf("tres pedidos seguidos do mesmo IP: visitas %v, esperava uma so, de 127.0.0.1", ips)
	}
}

func TestIPNovoOuPausaLongaAbremOutraVisita(t *testing.T) {
	a := novoAmbiente(t, func(c *Config) { c.TrustProxy = true })
	ana := a.registra(t, "Ana")

	// Cabecalho que nao e IP: o jogo segue e nada entra no registro.
	if st := a.chamaDoIP(t, ana, "nao-e-ip", "GET", "/v1/me/wallet"); st != http.StatusOK {
		t.Fatalf("pedido com IP torto: status %d, esperava o jogo seguir", st)
	}
	if ips := a.visitasDe(t, ana); len(ips) != 0 {
		t.Fatalf("IP torto entrou no registro: %v", ips)
	}

	a.chamaDoIP(t, ana, "203.0.113.7", "GET", "/v1/me/wallet")
	a.chamaDoIP(t, ana, "203.0.113.7", "POST", "/v1/runs/start")
	a.chamaDoIP(t, ana, "198.51.100.9", "GET", "/v1/me/wallet") // trocou de rede
	if ips := a.visitasDe(t, ana); len(ips) != 2 {
		t.Fatalf("dois IPs: visitas %v, esperava duas", ips)
	}

	// Meia hora e um minuto sem pedido do primeiro IP: o proximo abre outra visita.
	if _, err := a.store.pool.Exec(context.Background(), `
		update player_access
		   set first_seen = first_seen - interval '31 minutes',
		       last_seen = last_seen - interval '31 minutes'
		 where player_id = $1 and ip = '203.0.113.7'`, ana.id); err != nil {
		t.Fatalf("envelhecer visita: %v", err)
	}
	a.chamaDoIP(t, ana, "203.0.113.7", "GET", "/v1/me/wallet")

	ips := a.visitasDe(t, ana)
	quer := []string{"203.0.113.7", "198.51.100.9", "203.0.113.7"}
	if strings.Join(ips, ",") != strings.Join(quer, ",") {
		t.Errorf("visitas %v, esperava %v", ips, quer)
	}
}

func TestSemProxyConfiavelOCabecalhoNaoEscolheOIP(t *testing.T) {
	// Sem TRUST_PROXY, quem escreve o X-Forwarded-For e quem chamou — qualquer um
	// poria o IP que quisesse. Vale o IP da conexao.
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")

	a.chamaDoIP(t, ana, "203.0.113.7", "GET", "/v1/me/wallet")
	if ips := a.visitasDe(t, ana); len(ips) != 1 || ips[0] != "127.0.0.1" {
		t.Errorf("sem proxy confiavel: visitas %v, esperava so 127.0.0.1", ips)
	}
}

func TestRegistroDeAcessoVencidoSaiDoBanco(t *testing.T) {
	a := novoAmbiente(t, nil)
	ana := a.registra(t, "Ana")
	ctx := context.Background()

	if _, err := a.store.pool.Exec(ctx, `
		insert into player_access (player_id, ip, first_seen, last_seen) values
		  ($1, '203.0.113.7',  now() - interval '7 months', now() - interval '7 months'),
		  ($1, '198.51.100.9', now() - interval '5 months', now() - interval '5 months')`,
		ana.id); err != nil {
		t.Fatalf("semear visitas: %v", err)
	}

	n, err := a.store.PurgeAccess(ctx)
	if err != nil {
		t.Fatalf("apagar vencidas: %v", err)
	}
	ips := a.visitasDe(t, ana)
	if n != 1 || len(ips) != 1 || ips[0] != "198.51.100.9" {
		t.Errorf("apagou %d e sobraram %v; esperava apagar so a visita de 7 meses", n, ips)
	}
}

# O que falta

Lista viva do que ainda não está feito no Major Flyer, separada por quem faz.
Passo a passo de cada item do servidor: [server/README.md](server/README.md).

---

## É com você (contas, chaves e painéis)

Nada disso dá para fazer pelo código: depende de conta, senha ou painel que só
você acessa.

### Prova de integridade das partidas — Play Integrity

O código está pronto e desligado (`INTEGRITY_MODE=off`). Detalhes na
[Parte 4 do server/README.md](server/README.md#parte-4--a-prova-de-integridade-das-partidas).

- [x] **Google Cloud:** criar (ou escolher) o projeto e **anotar o número do
      projeto** — `MajorFlyer`, nº `943404852239`.
- [ ] **Google Cloud:** *APIs e serviços* → conferir que a **Play Integrity API**
      está ativada (o vínculo pelo Play Console costuma ativar sozinho).
- [x] **Play Console:** Major Flyer → **Proteção do app** → aba *Play Integrity
      API* → **Vincular projeto do Cloud**. Licença, app e dispositivo já ativados.
- [ ] **Play Console:** na mesma tela, marcar o **risco de acesso ao app**
      (*app access risk*) — é o que faz o Google avisar quando havia aplicativo
      controlando a tela durante a partida.
- [ ] **Google Cloud:** criar **conta de serviço** (sem papel nenhum) e baixar a
      **chave JSON**. A chave é uma senha: **nunca** commitar.
- [ ] **Dokploy:** pôr a chave em `GOOGLE_SERVICE_ACCOUNT` (em base64) e
      `INTEGRITY_MODE=log`; redeploy. O log tem que dizer
      `verificacao de integridade ligada`.
- [ ] **Dokploy:** se `MIN_SECONDS_PER_POINT` estiver fixado em `0.6`, trocar
      para `1.0` (o padrão do código já é 1.0).
- [x] **App:** número do projeto em `DEFAULT_CLOUD_PROJECT_NUMBER`
      ([src/services/integrity.js](src/services/integrity.js)).
- [ ] **App:** gerar **build novo** (`npm run aab` — entrou módulo nativo) e
      publicar no **teste interno**.
- [ ] Depois de alguns dias em `log`, conferir a coluna `game_sessions.integrity`
      (SQL no README) e, se quase tudo for `ok`, virar para `enforce`.
      **Antes de virar:** esperar a versão nova se espalhar (app antigo não manda
      selo e pararia de render moedas) e lembrar que **iPhone ainda não tem** a
      prova equivalente.

### Compra com dinheiro — Google Play

O código está pronto (Cometa só com dinheiro; os outros com moedas ou dinheiro).
Passo a passo na [Parte 5 do server/README.md](server/README.md#parte-5--compra-com-dinheiro-google-play).

- [ ] **Play Console:** criar o **perfil de pagamentos** (comerciante), com dados
      fiscais e conta bancária.
- [ ] **App:** build novo (`npm run aab`) numa faixa de teste — o Play Console só
      libera produtos depois de receber um app com o módulo de compras.
- [ ] **Play Console:** criar e ativar os produtos `bird_frost`, `bird_ember`,
      `bird_toxic`, `bird_phantom` e `bird_comet`, com o preço em reais.
- [ ] **Play Console:** dar à conta de serviço do servidor as permissões **Ver
      dados financeiros...** e **Gerenciar pedidos e assinaturas**.
- [ ] **Dokploy:** `GOOGLE_SERVICE_ACCOUNT` configurada (a mesma do Play
      Integrity) — sem ela, a loja só vende por moedas.
- [ ] **Play Console:** **Teste de licença** com as contas de teste, e uma compra
      de teste de ponta a ponta.
- [ ] **Play Console:** ficha **Segurança dos dados** com *Informações
      financeiras → Histórico de compras*; publicar a política **v2.2**.
- [ ] **Preços de teste em moedas** (Geada 10 ... Fantasma 18, escudo 5, nova
      chance 5) estão em produção: decidir se voltam aos originais.

### Servidor no ar

- [ ] **Domínio próprio com HTTPS** (Let's Encrypt pelo Dokploy). Hoje está em
      `traefik.me`, só HTTP — e **Android release bloqueia HTTP**.
- [ ] **SSV do AdMob** nas **duas** unidades premiadas, apontando para
      `https://SEU-DOMINIO/v1/ads/ssv` ([passo 7](server/README.md#7-a-verificação-dos-anúncios)).
      Sem isso, quem assiste ao vídeo nunca recebe o prêmio.
- [ ] **`DEFAULT_API_URL`** em [src/services/cloud.js](src/services/cloud.js)
      antes do build da loja — o EAS não leva o `.env`.
- [ ] Apagar do banco de produção os jogadores de teste criados em
      desenvolvimento.

### Jogo

- [ ] **Jogar com cada pássaro no celular**, no build novo: os testes
      automáticos cobrem os poderes, mas o ritmo (5 s de ímã, 2 s de invisível,
      20% mais lento) só se sente jogando. Ajustar é em
      [server/catalog.go](server/catalog.go), sem build nova.

### Loja e documentos

- [ ] Preencher os campos da política de privacidade
      ([privacidade/index.html](privacidade/index.html), v2.1):
      `[PROVEDOR DE HOSPEDAGEM]`, `[PAÍS DO SERVIDOR]`, `[NOME COMPLETO OU RAZÃO
      SOCIAL]`, `[CPF/CNPJ]`, `[CIDADE / ESTADO]`.
- [ ] Publicar a v2.2 no endereço que está na ficha do Google Play.
- [ ] Revisar a ficha **Segurança de Dados** do Play: a finalidade continua
      "prevenção de fraudes, segurança e conformidade", mas vale conferir que a
      declaração bate com a Seção 18 da política.

---

## É comigo (código)

Nada aqui bloqueia o jogo; são caminhos abertos, à espera de uma decisão sua.

- [ ] **App Attest (iPhone).** A prova de integridade só existe no Android. Sem
      isso, ligar o `enforce` com app iOS publicado recusaria as partidas do
      iPhone.
- [ ] **Chave de idempotência** para abrir partida, comprar, trocar vídeo por
      prêmio, nova chance e escudo. Hoje esses pedidos **não repetem sozinhos**
      de propósito: a primeira tentativa pode ter chegado e só a resposta ter se
      perdido. Com a chave, eles poderiam repetir com segurança.
- [x] **Poderes dos pássaros.** Um poder por pássaro da loja; trocar ou somar
      poderes é em [server/catalog.go](server/catalog.go) (ver README).
- [ ] **Conferir o voo no servidor** (refazer a partida a partir da semente).
      Fecharia o que sobra da fresta do app adulterado, mas exige a física do
      jogo reescrita em Go, idêntica à do celular. Descartado por ora — a prova
      de integridade cobre o caso prático.

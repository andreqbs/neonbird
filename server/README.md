# Servidor do Major Flyer

Conta, **economia** (moedas, vidas, escudos, novas chances e pássaros), grupos,
rodadas semanais e ranking do [Major Flyer](../README.md). **Go + Postgres**,
feito para caber na VPS mais simples: o binário tem ~12 MB, não precisa de
runtime instalado e a imagem final não tem shell nem gerenciador de pacotes.

O deploy é pelo **Dokploy**, que já está na VPS — ele é quem tem o Docker, o
Traefik e o Let's Encrypt. Não há nada para instalar no servidor.

**Tudo o que o jogador ganha ou compra existe só aqui.** O aplicativo não guarda
moeda, vida, escudo, nova chance nem pássaro no aparelho: ele mostra o que este
servidor respondeu por último. Sem servidor (ou sem internet), o jogo abre no
**modo treino** — dá para voar, sem moedas, vidas, loja nem ranking.

---

## O caminho inteiro, na ordem

São três metades: **subir o servidor**, **ligar a verificação dos anúncios** e
**contar ao aplicativo onde o servidor está**. Pular a do meio é o engano mais
caro aqui: o jogo funciona, mas quem assiste a um vídeo premiado nunca recebe o
prêmio.

**No Dokploy**

1. [Apontar o domínio](#1-o-domínio) para a VPS
2. [Criar o Postgres](#2-o-banco)
3. [Criar a aplicação a partir deste repositório](#3-a-aplicação)
4. [Preencher as variáveis](#4-as-variáveis)
5. [Domínio e HTTPS](#5-domínio-e-https)
6. [Deploy e conferência](#6-deploy)

**No AdMob**

7. [Ligar a verificação no servidor nas duas unidades premiadas](#7-a-verificação-dos-anúncios)

**No aplicativo**

8. [Escrever o endereço em `cloud.js`](#8-o-endereço-no-aplicativo)
9. [Testar com `npx expo start`](#9-testar-antes-de-gerar-o-build) antes de gastar um build
10. [Gerar o build da loja](#10-o-build-que-vai-para-a-loja)
11. [Conferir que os dois se falam](#11-conferindo-que-estão-conversando)

---

# Parte 1 — o servidor no Dokploy

Dois serviços: um **Postgres** e uma **Application** construída a partir do
`server/Dockerfile` deste repositório. É o caminho que aproveita o que o Dokploy
faz de melhor — backup do banco pelo painel, deploy por git e certificado
automático.

> Prefere subir os dois juntos, num serviço só? Existe também
> [`docker-compose.dokploy.yml`](docker-compose.dokploy.yml), pronto para o tipo
> **Compose** do Dokploy (sem portas publicadas, já na `dokploy-network`). Aí
> pule os passos 2 e 4: as variáveis vão na aba *Environment* do serviço Compose.

## 1. O domínio

No painel do seu domínio, crie um registro **A** apontando para o IP da VPS:

```
ranking.seudominio.com.    A    203.0.113.10
```

Espere propagar (`ping ranking.seudominio.com` já responder com o IP certo)
antes do passo 5 — o certificado só sai depois que o Let's Encrypt conseguir
achar a máquina pelo nome. Se você já usa um wildcard apontado para a VPS, não
precisa mexer em nada.

## 2. O banco

No Dokploy: **Create Service → Database → PostgreSQL**.

- Versão **16** (é a que os testes usam).
- Anote a senha que ele gera.
- Depois de criado, **Deploy**.

Na página do banco, copie a **connection string interna** (a que usa o nome do
serviço como host, não `localhost`). É ela que vai virar a `DATABASE_URL` no
passo 4.

Deixe o banco **sem domínio e sem porta pública**. Nada fora da VPS precisa
falar com ele — só a API, pela rede interna.

## 3. A aplicação

**Create Service → Application**.

| Campo | Valor |
| --- | --- |
| Provider | GitHub (ou Git, com a URL do repositório) |
| Repositório / branch | este projeto, `main` |
| Build Path | `/` (a raiz — deixe como veio) |
| Build Type | **Dockerfile** |
| Docker File | `server/Dockerfile` |
| Docker Context Path | `server` (ou vazio) |

O build funciona com o contexto em `server/` **ou** na raiz do repositório: o
`Dockerfile` procura o `go.mod` nos dois lugares, e o `.dockerignore` da raiz do
repositório faz só a pasta `server/` ser enviada. Mesmo assim, prefira `server` —
é o caminho mais curto e o mesmo que os testes usam.

> **Uma armadilha do Dokploy:** o *Build Path* entra no caminho do Dockerfile,
> mas **não** entra no contexto do build. *Build Path* `server` com *Docker
> Context Path* `.` acha o Dockerfile e ainda assim constrói a partir da raiz. Foi
> assim que o primeiro deploy falhou com `"/go.sum": not found`, antes de o
> `Dockerfile` aceitar os dois contextos.

## 4. As variáveis

Na aba **Environment** da aplicação:

```
DATABASE_URL=postgres://usuario:senha@nome-do-servico-do-banco:5432/majorflyer?sslmode=disable
PORT=8080
TRUST_PROXY=true
ALLOWED_ORIGINS=*
MAX_RUN_POINTS=2000
MIN_SECONDS_PER_POINT=0.6
MAX_RUN_MINUTES=180
ADS_DEV_AUTOVERIFY=false
RATE_PER_MINUTE=120
RATE_BURST=40
```

Três que não são opcionais:

- **`DATABASE_URL`** é a string interna que você copiou no passo 2. Se ela não
  vier com `?sslmode=disable`, acrescente: o Postgres do Dokploy não fala TLS na
  rede interna, e não precisa mesmo — esse tráfego não sai da máquina.
- **`TRUST_PROXY=true`** porque o Traefik do Dokploy está na frente. É o que faz
  o servidor acreditar no `X-Forwarded-For` para saber de quem é cada pedido.
  Sem isso, todo mundo vira "o IP do Traefik" e um jogador sozinho estoura o
  limite de pedidos de todos os outros.
- **`ADS_DEV_AUTOVERIFY=false`**, sempre, neste servidor. Ligada, ela entrega o
  prêmio do anúncio sem a confirmação do Google — qualquer um ganharia vidas,
  escudos e novas chances sem assistir nada. Ela existe só para o servidor de
  desenvolvimento ([Rodando fora do Dokploy](#rodando-fora-do-dokploy)).

O resto tem padrão razoável; a lista comentada está em
[`.env.example`](.env.example) e a tabela em [Configuração](#configuração).

## 5. Domínio e HTTPS

Na aba **Domains** da aplicação: **Add Domain**.

| Campo | Valor |
| --- | --- |
| Host | `ranking.seudominio.com` |
| Path | `/` |
| Container Port | **8080** |
| HTTPS | ligado, certificado **Let's Encrypt** |

A porta 8080 é onde o servidor escuta *dentro* do container — ela não fica
exposta na internet. Quem atende de fora é o Traefik, e é ele que tem o
certificado.

Não abra porta nenhuma no firewall da VPS por causa deste projeto: a 80 e a 443
do Dokploy já bastam.

## 6. Deploy

Clique em **Deploy** e acompanhe os logs. O primeiro build compila o Go e leva
alguns minutos; os seguintes reaproveitam as camadas e são bem mais rápidos.

Quando terminar:

```bash
curl https://ranking.seudominio.com/health
# {"ok":true,"season":{"id":"2026-09-06",...,"open":true}}

curl https://ranking.seudominio.com/v1/catalog
# {"birds":[{"id":"classic","name":"Major","price":0,...}, ...], "items":{...}, "rules":{...}}
```

O `/health` é o exame completo: se ele responde `"ok":true`, a API subiu, achou
o banco, criou as tabelas ([schema.sql](schema.sql) roda sozinho na subida) e já
sabe qual é a rodada da semana. O `/v1/catalog` mostra os pássaros e os preços
que o app vai exibir na loja.

Se quiser deploy automático a cada `git push`, ligue o webhook na aba
**Deployments** — o serviço reconstrói sozinho e o banco não é tocado.

---

# Parte 2 — a verificação dos anúncios

## 7. A verificação dos anúncios

Vidas, escudos e novas chances que se ganham assistindo a um vídeo premiado só
são entregues quando o **Google** avisa este servidor de que o vídeo terminou. O
aplicativo sozinho não consegue liberar prêmio nenhum — é isso que impede um app
modificado de dizer "assisti" sem ter assistido.

Para o aviso chegar, ligue a verificação nas **duas** unidades premiadas, no
[painel do AdMob](https://apps.admob.com):

1. **Apps** → *Major Flyer (Android)* → **Blocos de anúncios** → o premiado
   `ca-app-pub-6744388004633498/7044011331`.
2. **Configurações avançadas** → **Verificação do lado do servidor**.
3. URL de callback:

   ```
   https://ranking.seudominio.com/v1/ads/ssv
   ```

4. **Verificar URL**, depois **Salvar**.
5. Repita no app **iOS**, unidade `ca-app-pub-6744388004633498/7720010204`.

O servidor confere a assinatura de cada aviso com as chaves públicas do Google
([ssv.go](ssv.go)), grava a transação uma única vez (o Google repete o aviso
quando não recebe resposta) e o app troca cada vídeo confirmado por um prêmio em
até 30 minutos.

Sem este passo, o sintoma é exato: o jogador assiste ao vídeo inteiro, a tela
fica em *"Confirmando o prêmio..."* por alguns segundos e termina em *"O anúncio
ainda não foi confirmado"*.

> **Anúncio de teste não gera aviso.** O `npx expo start` e as builds de debug
> usam as unidades de teste do Google (ou a propaganda simulada, na web), e
> nenhuma delas chama este servidor. Para testar prêmios em desenvolvimento, use
> um servidor de desenvolvimento com `ADS_DEV_AUTOVERIFY=true` — nunca o do
> Dokploy.

---

# Parte 3 — ligando o aplicativo

O jogo não descobre o servidor sozinho. O endereço entra no código e viaja
dentro do build — trocar isso depois exige **build novo**.

## 8. O endereço no aplicativo

No topo de [`src/services/cloud.js`](../src/services/cloud.js):

```js
export const DEFAULT_API_URL = 'https://ranking.seudominio.com';
```

Sem barra no fim (o código tira, mas fica mais claro assim). É esta linha que
vale para o app da loja, e é ela que você deve editar.

> **Sobre o `EXPO_PUBLIC_API_URL`:** ele existe e ganha da constante, mas serve
> para a sua máquina, não para a loja. O `.env` está no `.gitignore`, e o EAS
> não manda para a nuvem arquivo que o git ignora — num `eas build` ele
> simplesmente não chega, e o app sai sem endereço (só modo treino). Se quiser
> mesmo usar variável no build da loja, ela tem que ser declarada no `eas.json`
> (`build.production.env`) ou no painel do EAS. Editar a constante é mais
> simples e não tem essa pegadinha.

## 9. Testar antes de gerar o build

Build de loja demora; um teste na sua rede não. Com o servidor no ar:

```bash
npm start          # ou: npx expo start
```

Abra no Expo Go. A Home tem que mostrar **moedas** e **vidas** (se aparecer
*"SEM CONEXÃO · MODO TREINO"*, o endereço não chegou). Jogue uma partida: as
moedas aparecem no vão dos obstáculos, e ao fim o painel mostra quantas o
servidor creditou. Abra a **Loja**: os cinco pássaros e os dois itens têm que
estar lá, com os preços do catálogo.

Os prêmios de anúncio **não** vão funcionar contra o servidor do Dokploy nesse
teste — veja a nota do passo 7.

## 10. O build que vai para a loja

```bash
npm run aab      # eas build --platform android --profile production
```

Confirme antes de gastar o build: a linha do passo 8 está salva e **commitada**
(o EAS envia o que está no git).

## 11. Conferindo que estão conversando

Deixe os logs da aplicação abertos no Dokploy e abra o jogo no celular:

| Quando | O que aparece no log |
| --- | --- |
| Abrir o app | `POST /v1/players`, `GET /v1/catalog`, `GET /v1/me/wallet` |
| Tocar em Jogar | `POST /v1/runs/start` |
| Cair e continuar | `POST /v1/runs/{id}/continue` |
| Fim da partida | `POST /v1/runs/{id}/finish` |
| Comprar na loja | `POST /v1/shop/buy` |
| Assistir a um vídeo premiado | `GET /v1/ads/ssv` (o Google) e `POST /v1/ads/claim` (o app) |

Se **nada** aparece no log quando você mexe no app, o problema é do lado do
aplicativo (endereço vazio ou build antigo), não do servidor.

### O teste que vale a pena fazer uma vez

Dois celulares (ou um celular e o navegador com `npm run web`):

1. Nos dois, **Configurações** → confira o apelido e copie o **código** do
   segundo aparelho.
2. No primeiro: **Ranking** → aba *Grupo* → criar grupo. Você fica com a 👑.
3. Ainda no primeiro, cole o código do segundo em *Chamar alguém*.
4. Jogue uma partida em cada. O total do grupo tem que ser a **soma** das duas,
   e as moedas de cada um aparecem na Home de cada aparelho.

---

# Referência

## O que cada rota faz

Tudo responde JSON. As que escrevem exigem os cabeçalhos `X-Player-Id` e
`X-Player-Secret` — o par que o aplicativo criou na primeira abertura
([identity.js](../src/services/identity.js)).

**Conta e economia**

| Rota | O que faz |
| --- | --- |
| `GET /health` | Diz se o banco responde e qual é a rodada. É o exame do Docker. |
| `POST /v1/players` | Cadastra o aparelho ou troca o apelido. Corpo: `{id, secret, name}`. |
| `GET /v1/catalog` | Pássaros, preços e regras. Público. |
| `GET /v1/me/wallet` | Moedas, vidas, escudos, novas chances e pássaros do jogador. |
| `POST /v1/runs/start` | Abre uma partida: desconta uma vida e devolve a semente das moedas. |
| `POST /v1/runs/{id}/finish` | Fecha a partida. Corpo: `{points, coinOrdinals}` — os números dos obstáculos das moedas pegas. |
| `POST /v1/runs/{id}/continue` | Nova chance. Corpo: `{method}` — `stock` (guardada) ou `coins`. |
| `POST /v1/runs/{id}/shield` | Usa um escudo guardado na partida. |
| `POST /v1/shop/buy` | Compra em moedas. Corpo: `{item}` — `bird` (com `birdId`), `shield` ou `continue`. |
| `POST /v1/me/bird` | Escolhe o pássaro das próximas partidas. Corpo: `{birdId}`. |
| `POST /v1/ads/claim` | Troca um vídeo confirmado pelo prêmio. Corpo: `{kind}` — `lives`, `shield` ou `continue`. Sem confirmação ainda, responde **202**. |
| `GET /v1/ads/ssv` | O aviso do Google (passo 7). Não é chamado pelo app. |

**Grupos e ranking**

| Rota | O que faz |
| --- | --- |
| `GET /v1/groups/me` | O grupo do jogador nesta rodada (ou `null`). |
| `POST /v1/groups` | Cria um grupo, com quem criou já de coroa. Corpo: `{name}`. |
| `POST /v1/groups/members` | Só o líder. Corpo: `{playerId}` — o código público do convidado. |
| `DELETE /v1/groups/me` | Sai do grupo. |
| `GET /v1/rankings/players` | Ranking individual da rodada. `?limit=50` (teto 200). |
| `GET /v1/rankings/groups` | Ranking dos grupos da rodada. |
| `GET /v1/me/standing` | A posição do jogador, para quem ficou fora da lista. |

Erro nunca volta cru: vem `{"error": "texto em português", "code": "..."}`. O
texto vai direto para a tela (*"moedas insuficientes"*, *"a nova chance desta
partida já foi usada"*); o código é o que o app usa para decidir o que fazer
(`no_lives` abre o vídeo das vidas, por exemplo).

## As regras que o servidor garante

**Partidas e moedas**

- Abrir partida **custa uma vida**, e só é possível com vida. Um jogador tem
  **uma partida aberta por vez**: abrir outra encerra a anterior sem render nada
  — senão daria para abrir dez e fechar só a melhor.
- A posição de cada moeda sai de uma **semente sorteada aqui** na abertura. Ao
  fechar, o app manda os números dos obstáculos das moedas que pegou, e o
  servidor refaz a conta para cada um ([coins.go](coins.go)): só vale moeda que
  existia naquele obstáculo, uma vez, e até o ponto aonde o jogador chegou. A
  mesma conta está em [`src/game/coins.js`](../src/game/coins.js), e os dois
  lados têm testes com os mesmos números de referência.
- **Uma moeda a cada 3 obstáculos**, em média, e **+10 por fase fechada**.
- O placar precisa **caber no tempo**: cada ponto exige pelo menos
  `MIN_SECONDS_PER_POINT` desde a abertura, medidos no relógio do banco — o
  obstáculo mais rápido do jogo leva ~1,15 s para chegar ao pássaro. Placar
  impossível fecha a partida como **recusada**: sem moedas e sem ranking.
- Só partida **fechada** entra no ranking. Não existe mais rota que aceite um
  placar solto.

**Itens e loja**

- **Nova chance**: uma por partida, paga com uma guardada ou com moedas.
- **Escudo**: gasta um guardado, dentro de uma partida aberta.
- Pássaro, escudo e nova chance se compram **só com moedas**, e pássaro não se
  compra duas vezes. Só dá para usar pássaro comprado.
- Prêmio de anúncio **só com o aviso assinado do Google**, e **um prêmio por
  vídeo**.
- Toda mudança de saldo acontece com a carteira **travada** na transação (dois
  toques no mesmo instante não gastam a mesma moeda duas vezes) e deixa uma
  linha no **livro-razão** (`ledger`), que nunca é apagado.

**Grupos e rodadas**

- A rodada abre **domingo às 20h** e fecha **domingo às 18h** (fuso −3, sem
  horário de verão). Nas duas horas de apuração a partida ainda rende moedas,
  mas não mexe no ranking.
- **8 jogadores** por grupo; **um grupo por jogador por rodada** — isso é um
  índice único, não um `if`, então dois convites simultâneos não furam.
- **Só o líder** chama gente nova. Se o líder sai, a coroa passa para o membro
  mais antigo; se não sobra ninguém, o grupo se desfaz.

### O limite honesto

A física do jogo roda no celular, e o servidor não assiste ao voo. O que ele
garante é que ninguém ganha **o que não existia** (moeda fora da semente, placar
mais rápido que o jogo, prêmio sem vídeo, compra sem saldo). Um app adulterado
que voe sozinho **de forma plausível** ainda passa — isso nenhum jogo com a
física no aparelho consegue impedir. O livro-razão existe para quando for
preciso investigar alguém.

## Pássaros e habilidades

O catálogo mora em [catalog.go](catalog.go): nome, frase, preço e a vaga da
habilidade de cada um. Mudar um preço é editar esse arquivo e fazer redeploy —
**não** precisa de build novo do app, que lê o catálogo a cada abertura.

As habilidades ainda não existem: cada pássaro novo nasce com
`ability: {id, status: "soon"}` (o de sempre vem com `null`), e o app mostra
*"em breve"*. Quando uma for definida, ela ganha comportamento no app
([abilities.js](../src/game/abilities.js)) — e, **se mexer em moeda ou
pontuação**, a regra correspondente precisa entrar aqui também, senão a
conferência da partida recusa o que a habilidade legitimamente rendeu.

## Configuração

Tudo por variável de ambiente, com padrão razoável. A lista comentada está em
[`.env.example`](.env.example); em resumo:

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `DATABASE_URL` | — | Obrigatória. No Dokploy, a string interna do Postgres. |
| `PORT` | `8080` | Porta em que o servidor escuta dentro do container. |
| `ALLOWED_ORIGINS` | `*` | CORS, para a versão web. O app nativo não passa por aqui. |
| `TRUST_PROXY` | `false` | **`true` no Dokploy**, que tem o Traefik na frente. |
| `MAX_RUN_POINTS` | `2000` | Teto de pontos por partida. |
| `MIN_SECONDS_PER_POINT` | `0.6` | Piso de tempo por ponto. Placar mais rápido é recusado. |
| `MAX_RUN_MINUTES` | `180` | Partida aberta há mais tempo que isso não fecha mais. |
| `ADS_DEV_AUTOVERIFY` | `false` | **Só em desenvolvimento**: prêmio de anúncio sem o aviso do Google. |
| `ADMOB_KEYS_URL` | chaves do Google | De onde vêm as chaves públicas do SSV. Não mexa. |
| `RATE_PER_MINUTE` / `RATE_BURST` | `120` / `40` | Limite de pedidos por IP (o aviso do Google fica de fora). |

Mudou uma variável? **Redeploy** — o container é recriado com os valores novos.

---

# Manutenção

## Atualizando

`git push` na branch configurada e **Deploy** no painel (ou automático, se o
webhook estiver ligado). O banco não é tocado: as tabelas são criadas com
`if not exists` na subida. Um deploy no meio do fechamento de uma partida não
perde as moedas dela — o servidor termina o que está em andamento antes de sair.

## Backup

Use o backup do próprio Dokploy na página do Postgres (agendamento + destino S3).
É o caminho mais confiável, porque a cópia sai da máquina — backup que mora no
mesmo servidor que o banco não é backup. Agora que o banco guarda as moedas e as
compras de todo mundo, ele deixou de ser opcional.

Manualmente, pelo terminal da VPS:

```bash
docker exec -t <container-do-postgres> pg_dump -U majorflyer majorflyer | gzip > backup-$(date +%F).sql.gz
```

## De onde vieram as moedas de alguém

O código do jogador está em *Configurações* no app dele. No terminal do Postgres
(Dokploy → banco → **Terminal**, ou `psql`):

```sql
-- saldo atual
select coins, lives, shields, continues, equipped_bird
  from wallets where player_id = 'CODIGO-DO-JOGADOR';

-- as ultimas 50 mudancas de saldo, com o motivo
select created_at, kind, coins, lives, shields, continues, ref
  from ledger where player_id = 'CODIGO-DO-JOGADOR'
 order by created_at desc limit 50;

-- partidas recusadas (placar impossivel) ou abandonadas
select started_at, status, points, coins
  from game_sessions where player_id = 'CODIGO-DO-JOGADOR'
 order by started_at desc limit 20;
```

## Testes

Rodam **na sua máquina**, não na VPS. Sobem um Postgres descartável (em memória,
morre no fim):

```bash
cd server
docker compose -f docker-compose.test.yml run --rm --build test
```

O código entra no container pelo *build*, e não por pasta montada: no Docker
Desktop do Windows a montagem de pasta já travou a criação do container sem
mensagem nenhuma. O `--build` é o que faz a imagem acompanhar o código novo.

Três conjuntos:

- **As contas que o app refaz**: a rodada da semana (oito semanas, hora a hora)
  e a das moedas, com os mesmos números de referência do `npm test` do app.
- **A verificação do Google**: chamadas assinadas com uma chave gerada no teste
  — só a assinatura certa passa; trocar o jogador no meio do caminho não passa.
- **A API contra o Postgres**, tentando ganhar o que não tem direito: moeda que
  não existia, placar rápido demais, partida fechada duas vezes, nova chance
  repetida, compra sem saldo, prêmio de anúncio sem aviso do Google (ou com
  aviso falso, ou o mesmo aviso duas vezes). E o caminho honesto junto, porque o
  teste só vale se ele continuar funcionando: partida, loja, grupo, coroa,
  ranking.

O lado do jogo nessa conversa (o que o app manda, que ele nunca soma saldo nem
grava economia no aparelho) é coberto pelo `npm test` da raiz.

> O `TEST_DATABASE_URL` usado pelos testes precisa apontar para um banco
> **descartável** — eles limpam as tabelas antes de cada caso. O
> `docker-compose.test.yml` já cuida disso; não aponte para o banco de produção.

## Rodando fora do Dokploy

O [`docker-compose.yml`](docker-compose.yml) sobe a API + Postgres em qualquer
máquina com Docker, publicando a porta direto:

```bash
cp .env.example .env    # troque a senha
docker compose up -d --build
```

É o **servidor de desenvolvimento**: para testar os prêmios de anúncio no
`npx expo start`, ponha `ADS_DEV_AUTOVERIFY=true` no `.env` dele. Numa VPS crua o
HTTPS fica por sua conta, com um proxy na frente, e `TRUST_PROXY` só deve ser
ligado se esse proxy existir.

## Se algo der errado

| Sintoma | Quase sempre é |
| --- | --- |
| Build falha com `"/go.sum": not found` | o deploy ainda usa o `Dockerfile` antigo com o contexto na raiz: publique o commit com o `Dockerfile` novo, ou ponha *Docker Context Path* = `server` (passo 3) |
| `falta DATABASE_URL` nos logs | a variável não foi salva, ou o deploy foi antes de salvar |
| `banco não respondeu` | o Postgres ainda subindo, ou host/senha errados na `DATABASE_URL` |
| `/health` não responde pelo domínio | DNS ainda propagando, ou o domínio não foi criado na aba *Domains* com a porta 8080 |
| App diz "SEM CONEXÃO · MODO TREINO" | o endereço não chegou nele: `DEFAULT_API_URL` vazio, ou build antigo (passos 8 e 10) |
| Assisti ao vídeo e não ganhei nada | a verificação não está ligada na unidade premiada, ou a URL do callback está errada (passo 7) |
| Prêmio não sai no `expo start` | anúncio de teste não gera aviso: use um servidor de desenvolvimento com `ADS_DEV_AUTOVERIFY=true` |
| `ssv recusado` nos logs | aviso sem assinatura válida. Se forem muitos e sem motivo, confira se algum proxy está alterando a query string |
| Partidas de todo mundo recusadas como "rápidas demais" | `MIN_SECONDS_PER_POINT` alto demais para o jogo atual |
| Nenhum pedido no log ao mexer no app | o problema está no aplicativo, não aqui |
| Todos os jogadores caem no limite de pedidos juntos | `TRUST_PROXY` não está `true`: o servidor vê só o IP do Traefik |

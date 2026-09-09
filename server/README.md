# Servidor do ranking — Major Flyer

Grupos, rodadas semanais e ranking (individual e por grupo) do
[Major Flyer](../README.md). **Go + Postgres**, feito para caber na VPS mais
simples: o binário tem ~12 MB, não precisa de runtime instalado e a imagem final
não tem shell nem gerenciador de pacotes.

O deploy é pelo **Dokploy**, que já está na VPS — ele é quem tem o Docker, o
Traefik e o Let's Encrypt. Não há nada para instalar no servidor.

O jogo **não depende** deste servidor para funcionar: sem ele (ou sem internet),
recorde e histórico continuam no aparelho e a tela de ranking diz que o online
está desligado. O servidor é o extra.

---

## O caminho inteiro, na ordem

São duas metades: **subir o servidor** e **contar ao aplicativo onde ele está**.
Só as duas juntas ligam o ranking — servidor no ar com o app sem o endereço
continua mostrando "ranking online desligado", e é esse o engano mais fácil de
cometer aqui.

**No Dokploy**

1. [Apontar o domínio](#1-o-domínio) para a VPS
2. [Criar o Postgres](#2-o-banco)
3. [Criar a aplicação a partir deste repositório](#3-a-aplicação)
4. [Preencher as variáveis](#4-as-variáveis)
5. [Domínio e HTTPS](#5-domínio-e-https)
6. [Deploy e conferência](#6-deploy)

**No aplicativo**

7. [Escrever o endereço em `cloud.js`](#7-o-endereço-no-aplicativo)
8. [Testar com `npx expo start`](#8-testar-antes-de-gerar-o-build) antes de gastar um build
9. [Gerar o build da loja](#9-o-build-que-vai-para-a-loja)
10. [Conferir que os dois se falam](#10-conferindo-que-estão-conversando)

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
| Build Type | **Dockerfile** |
| Docker File | `server/Dockerfile` |
| Docker Context Path | `server` |

O **context path** é o detalhe que faz ou quebra este passo: o `Dockerfile`
copia `go.mod` e `go.sum` de dentro de `server/`. Se o contexto ficar na raiz do
repositório, o build falha logo no começo dizendo que não achou o `go.mod`.

## 4. As variáveis

Na aba **Environment** da aplicação:

```
DATABASE_URL=postgres://usuario:senha@nome-do-servico-do-banco:5432/majorflyer?sslmode=disable
PORT=8080
TRUST_PROXY=true
ALLOWED_ORIGINS=*
MAX_RUN_POINTS=2000
MIN_RUN_GAP_SECONDS=5
RATE_PER_MINUTE=120
RATE_BURST=40
```

Duas que não são opcionais:

- **`DATABASE_URL`** é a string interna que você copiou no passo 2. Se ela não
  vier com `?sslmode=disable`, acrescente: o Postgres do Dokploy não fala TLS na
  rede interna, e não precisa mesmo — esse tráfego não sai da máquina.
- **`TRUST_PROXY=true`** porque o Traefik do Dokploy está na frente. É o que faz
  o servidor acreditar no `X-Forwarded-For` para saber de quem é cada pedido.
  Sem isso, todo mundo vira "o IP do Traefik" e um jogador sozinho estoura o
  limite de pedidos de todos os outros.

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
```

Esse JSON é o exame completo: se ele responde `"ok":true`, a API subiu, achou o
banco, criou as tabelas ([schema.sql](schema.sql) roda sozinho na subida) e já
sabe qual é a rodada da semana.

Nos logs da aplicação, a linha da subida é:

```
{"level":"INFO","msg":"no ar","porta":"8080","rodada":"2026-09-06","aberta":true}
```

Se quiser deploy automático a cada `git push`, ligue o webhook na aba
**Deployments** — o serviço reconstrói sozinho e o banco não é tocado.

---

# Parte 2 — ligando o aplicativo

O jogo não descobre o servidor sozinho. O endereço entra no código e viaja
dentro do build — trocar isso depois exige **build novo**.

## 7. O endereço no aplicativo

No topo de [`src/services/cloud.js`](../src/services/cloud.js):

```js
export const DEFAULT_API_URL = 'https://ranking.seudominio.com';
```

Sem barra no fim (o código tira, mas fica mais claro assim). É esta linha que
vale para o app da loja, e é ela que você deve editar.

> **Sobre o `EXPO_PUBLIC_API_URL`:** ele existe e ganha da constante, mas serve
> para a sua máquina, não para a loja. O `.env` está no `.gitignore`, e o EAS
> não manda para a nuvem arquivo que o git ignora — num `eas build` ele
> simplesmente não chega, e o app sai sem endereço. Se quiser mesmo usar
> variável no build da loja, ela tem que ser declarada no `eas.json`
> (`build.production.env`) ou no painel do EAS. Editar a constante é mais
> simples e não tem essa pegadinha.

## 8. Testar antes de gerar o build

Build de loja demora; um teste na sua rede não. Com o servidor no ar:

```bash
npm start          # ou: npx expo start
```

Abra no Expo Go, vá em **Ranking**. A aba *Individual* deve carregar (mesmo
vazia, "ninguém pontuou ainda" já prova que houve resposta), e *Grupo* deve
oferecer criar um. Jogue uma partida e ela tem que aparecer no ranking.

Como o Dokploy já entrega HTTPS desde o primeiro deploy, o mesmo endereço serve
para o teste e para a loja — não há a etapa de "testar em `http://` e trocar
depois".

## 9. O build que vai para a loja

```bash
npm run aab      # eas build --platform android --profile production
```

Confirme antes de gastar o build: a linha do passo 7 está salva e **commitada**
(o EAS envia o que está no git).

## 10. Conferindo que estão conversando

Deixe os logs da aplicação abertos no Dokploy e abra o jogo no celular. Na
abertura o app se apresenta:

```
{"level":"INFO","msg":"pedido","metodo":"POST","path":"/v1/players","status":200,...}
```

Ao terminar uma partida, `POST /v1/runs`. Ao abrir a tela de ranking,
`GET /v1/rankings/players` e `GET /v1/rankings/groups`. Se **nada** aparece no
log quando você mexe no app, o problema é do lado do aplicativo (endereço vazio
ou build antigo), não do servidor.

Para conferir o outro lado — que os pontos chegaram mesmo ao banco:

```bash
curl https://ranking.seudominio.com/v1/rankings/players
```

### O teste que vale a pena fazer uma vez

Dois celulares (ou um celular e o navegador com `npm run web`):

1. Nos dois, **Configurações** → confira o apelido e copie o **código** do
   segundo aparelho.
2. No primeiro: **Ranking** → aba *Grupo* → criar grupo. Você fica com a 👑.
3. Ainda no primeiro, cole o código do segundo em *Chamar alguém*.
4. Jogue uma partida em cada. O total do grupo tem que ser a **soma** das duas,
   e os dois nomes aparecem na lista.

Isso exercita tudo que o servidor faz. Se funcionar, está ligado de verdade.

---

# Referência

## O que cada rota faz

Tudo responde JSON. As que escrevem exigem os cabeçalhos `X-Player-Id` e
`X-Player-Secret` — o par que o aplicativo criou na primeira abertura
([identity.js](../src/services/identity.js)).

| Rota | O que faz |
| --- | --- |
| `GET /health` | Diz se o banco responde e qual é a rodada. É o exame do Docker. |
| `POST /v1/players` | Cadastra o aparelho ou troca o apelido. Corpo: `{id, secret, name}`. |
| `POST /v1/runs` | Manda um placar. Corpo: `{points}`. |
| `GET /v1/groups/me` | O grupo do jogador nesta rodada (ou `null`). |
| `POST /v1/groups` | Cria um grupo, com quem criou já de coroa. Corpo: `{name}`. |
| `POST /v1/groups/members` | Só o líder. Corpo: `{playerId}` — o código público do convidado. |
| `DELETE /v1/groups/me` | Sai do grupo. |
| `GET /v1/rankings/players` | Ranking individual da rodada. `?limit=50` (teto 200). |
| `GET /v1/rankings/groups` | Ranking dos grupos da rodada. |
| `GET /v1/me/standing` | A posição do jogador, para quem ficou fora da lista. |

Erro nunca volta cru: vem `{"error": "texto em português"}`, com o texto já
escrito para o jogador ler na tela — *"o grupo já tem 8 jogadores"*, *"só o líder
pode chamar gente nova"*.

## As regras que o servidor garante

- A rodada abre **domingo às 20h** e fecha **domingo às 18h** (fuso −3, sem
  horário de verão). As duas horas que sobram são a apuração: ninguém pontua.
- **8 jogadores** por grupo; **um grupo por jogador por rodada** — isso é um
  índice único, não um `if`, então dois convites simultâneos não furam.
- **Só o líder** chama gente nova. Se o líder sai, a coroa passa para o membro
  mais antigo; se não sobra ninguém, o grupo se desfaz.
- Placar tem teto por partida (`MAX_RUN_POINTS`) e intervalo mínimo entre
  partidas do mesmo jogador (`MIN_RUN_GAP_SECONDS`), e há limite de pedidos por
  IP. Isso não torna o jogo impossível de trapacear — o cliente é um app na mão
  do jogador —, mas tira do caminho o script que manda um milhão de pontos.

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
| `MIN_RUN_GAP_SECONDS` | `5` | Intervalo mínimo entre partidas do mesmo jogador. |
| `RATE_PER_MINUTE` / `RATE_BURST` | `120` / `40` | Limite de pedidos por IP. |

Mudou uma variável? **Redeploy** — o container é recriado com os valores novos.

---

# Manutenção

## Atualizando

`git push` na branch configurada e **Deploy** no painel (ou automático, se o
webhook estiver ligado). O banco não é tocado: as tabelas são criadas com
`if not exists` na subida. Um deploy no meio de um envio de placar não perde o
placar — o servidor termina o que está em andamento antes de sair.

## Backup

Use o backup do próprio Dokploy na página do Postgres (agendamento + destino S3).
É o caminho mais confiável, porque a cópia sai da máquina — backup que mora no
mesmo servidor que o banco não é backup.

Manualmente, pelo terminal da VPS:

```bash
docker exec -t <container-do-postgres> pg_dump -U majorflyer majorflyer | gzip > backup-$(date +%F).sql.gz
```

## Testes

Rodam **na sua máquina**, não na VPS. Sobem um Postgres descartável (em memória,
morre no fim):

```bash
cd server
docker compose -f docker-compose.test.yml run --rm test
```

São dois conjuntos. Um confere a **conta da rodada** sem banco nenhum — oito
semanas hora a hora, para garantir que todo instante cai dentro de exatamente
uma rodada e que o servidor e o aplicativo nunca discordem sobre qual é ela. O
outro sobe a API de verdade contra o Postgres e percorre o caminho do jogador:
registrar, pontuar, criar grupo, convidar, recusar quem não é líder, encher o
grupo, passar a coroa. Banco de mentira não serviria: metade das regras mora em
índice e em SQL, e é justamente essa metade que precisa ser conferida.

O lado do jogo nessa conversa (cabeçalhos, fila offline, o que ele refaz e o que
não refaz) é coberto pelo `npm test` da raiz.

> O `TEST_DATABASE_URL` usado pelos testes precisa apontar para um banco
> **descartável** — eles limpam as tabelas antes de cada caso. O
> `docker-compose.test.yml` já cuida disso; não aponte para o banco de produção.

## Rodando fora do Dokploy

O [`docker-compose.yml`](docker-compose.yml) sobe a API + Postgres em qualquer
máquina com Docker, publicando a porta direto (`cp .env.example .env`, trocar a
senha, `docker compose up -d --build`). Serve para desenvolver no seu computador
ou para uma VPS crua — aí o HTTPS fica por sua conta, com um proxy na frente, e
`TRUST_PROXY` só deve ser ligado se esse proxy existir.

## Se algo der errado

| Sintoma | Quase sempre é |
| --- | --- |
| Build falha em `COPY go.mod go.sum` | *Docker Context Path* não é `server` (passo 3) |
| `falta DATABASE_URL` nos logs | a variável não foi salva, ou o deploy foi antes de salvar |
| `banco não respondeu` | o Postgres ainda subindo, ou host/senha errados na `DATABASE_URL` |
| `/health` não responde pelo domínio | DNS ainda propagando, ou o domínio não foi criado na aba *Domains* com a porta 8080 |
| App diz "ranking online desligado" | o endereço não chegou nele: `DEFAULT_API_URL` vazio, ou build antigo (passos 7 e 9) |
| Nenhum pedido no log ao mexer no app | o problema está no aplicativo, não aqui |
| Todos os jogadores caem no limite de pedidos juntos | `TRUST_PROXY` não está `true`: o servidor vê só o IP do Traefik |

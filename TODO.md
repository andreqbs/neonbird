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

- [ ] **Google Cloud:** criar (ou escolher) o projeto e **anotar o número do
      projeto** — só dígitos.
- [ ] **Google Cloud:** *APIs e serviços* → ativar a **Play Integrity API**.
- [ ] **Play Console:** Major Flyer → **Proteção do app** → aba *Play Integrity
      API* → **Vincular projeto do Cloud**.
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
- [ ] **App:** escrever o número do projeto em `DEFAULT_CLOUD_PROJECT_NUMBER`
      ([src/services/integrity.js](src/services/integrity.js)), gerar **build
      novo** (`npm run aab` — entrou módulo nativo) e publicar no **teste
      interno**.
- [ ] Depois de alguns dias em `log`, conferir a coluna `game_sessions.integrity`
      (SQL no README) e, se quase tudo for `ok`, virar para `enforce`.
      **Antes de virar:** esperar a versão nova se espalhar (app antigo não manda
      selo e pararia de render moedas) e lembrar que **iPhone ainda não tem** a
      prova equivalente.

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

### Loja e documentos

- [ ] Preencher os campos da política de privacidade
      ([privacidade/index.html](privacidade/index.html), v2.1):
      `[PROVEDOR DE HOSPEDAGEM]`, `[PAÍS DO SERVIDOR]`, `[NOME COMPLETO OU RAZÃO
      SOCIAL]`, `[CPF/CNPJ]`, `[CIDADE / ESTADO]`.
- [ ] Publicar a v2.1 no endereço que está na ficha do Google Play.
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
- [ ] **Habilidades dos pássaros.** A vaga está pronta dos dois lados
      ([abilities.js](src/game/abilities.js) e o catálogo do servidor); falta
      definir o que cada uma faz. Se mexer em moeda ou pontuação, a regra precisa
      entrar no servidor junto.
- [ ] **Conferir o voo no servidor** (refazer a partida a partir da semente).
      Fecharia o que sobra da fresta do app adulterado, mas exige a física do
      jogo reescrita em Go, idêntica à do celular. Descartado por ora — a prova
      de integridade cobre o caso prático.

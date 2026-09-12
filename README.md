# Major Flyer

Jogo estilo *Flappy Bird* feito em **React Native (Expo)** com física real do
**matter-js**. Toque na tela para bater as asas; sem toque, a gravidade puxa o
pássaro para baixo.

A tela **acompanha a rotação do aparelho** — retrato e paisagem, sem escolher nada.

---

## Versoes

O projeto roda no **Expo SDK 57** (React Native 0.86, React 19.2) com **matter-js 0.20**.

Isso importa por um motivo pratico: **o Expo Go da Play Store so suporta o SDK mais
recente**. Um projeto preso num SDK antigo nao abre nele — e pior, dependencias
transitivas podem misturar versoes e derrubar o app com erros nativos do tipo
`NoClassDefFoundError: ...AnyTypeCache`. Se for atualizar, atualize tudo junto:

```bash
npx expo install expo@latest --fix
```

E confira que nao sobrou nada fora da linha:

```bash
npx expo-doctor
```

---

## Rodando

```bash
npm install
```

```bash
npx expo start
```

Depois:

- **Celular** — instale o app **Expo Go** (Android/iOS) e escaneie o QR Code do
  terminal. Se ele reclamar de versao, atualize o Expo Go pela loja.
- **Android emulador** — tecle `a` no terminal do Expo.
- **iOS simulador** (só macOS) — tecle `i`.
- **Navegador** — tecle `w`. Serve para conferir rápido; na web a orientação é o
  tamanho da janela.

Testes do núcleo do jogo (rodam no Node, sem emulador):

```bash
npm test
```

Testes do servidor do ranking (sobem um Postgres descartável e o derrubam):

```bash
cd server && docker compose -f docker-compose.test.yml run --rm --build test
```

---

## Telas

| Tela | O que tem |
|------|-----------|
| **Início** | Jogar (ou Treinar, sem internet), Loja, Ranking e Configurações; recorde, moedas e as 5 vidas |
| **Loja** | 5 pássaros novos, escudos e novas chances — em moedas ou assistindo a um vídeo |
| **Ranking** | Abas *Individual*, *Grupo* e *Seus voos* (histórico local) |
| **Configurações** | Música de fundo, som do toque, efeitos, nome e código do jogador, apagar recordes |
| **Jogo** | Partida, placar e moedas ao vivo, escudo guardado, nova chance, pausa e fim de jogo |

---

## Grupos, rodadas e ranking

O jogo tem uma parte online: **rodadas semanais**, ranking **individual** e
ranking **por grupo**, com a pontuação do grupo sendo a soma do que seus
jogadores fizerem na rodada.

### Sem cadastro: o aparelho é a conta

Ninguém cria login. Na primeira abertura o app inventa dois UUIDs
([identity.js](src/services/identity.js)):

- **o código** — público. É o que o jogador copia em *Configurações* e manda
  para quem vai chamá-lo para um grupo;
- **o segredo** — nunca aparece na tela e só viaja nas chamadas ao servidor. É
  ele que impede alguém de, sabendo o código dos outros, mandar pontos no nome
  deles.

O apelido é editável e vale para o ranking e para o grupo. Trocar de aparelho
hoje significa um código novo — é o preço de não pedir cadastro para jogar.

### A rodada da semana

Abre **domingo às 20h** e fecha **domingo seguinte às 18h**. As duas horas que
sobram são a **janela de apuração**: ninguém mais pontua e os totais podem ser
conferidos antes da rodada nova. A conta está em
[season.js](src/services/season.js) e é a mesma no servidor — o id da rodada é a
data do domingo em que ela abriu, então os dois lados chegam ao mesmo texto sem
precisar combinar nada. `npm test` varre oito semanas hora a hora conferindo que
todo instante cai dentro de exatamente uma rodada.

### Os grupos

- Quem cria vira **líder**, e aparece com **👑** na lista.
- **Só o líder chama** gente nova, e chama pelo código do jogador.
- Até **8 jogadores** por grupo, **um grupo por jogador por rodada**.
- Se o líder sai, a coroa passa para o membro mais antigo; se não sobrar
  ninguém, o grupo se desfaz.
- O grupo tem espaço para **escudo** (`crest`): hoje é a inicial do nome num
  selo, e o campo já existe no banco para quando as artes prontas entrarem.

Essas regras moram **no servidor**, não na tela
([schema.sql](server/schema.sql), [store.go](server/store.go)): regra que vive só
no cliente é regra que dá para burlar com um app modificado.

### A arquitetura, e por que ela é essa

**Um servidor próprio, em [`server/`](server/): Go + Postgres, num `docker
compose up -d`.** Ele é deste repositório e roda na sua VPS — sem serviço de
terceiro no meio, sem mensalidade e sem cota.

- **Go** porque o que vai para a VPS é um binário estático de ~12 MB, sem runtime
  para instalar, que sobe em milissegundos e ocupa poucos MB de RAM. A imagem
  final é `distroless`: não tem shell, nem gerenciador de pacotes, nem
  compilador — menos coisa para dar errado num servidor exposto.
- **Postgres** porque tudo que este ranking faz é juntar e somar por rodada
  (`sum(points) … group by`), e porque as regras que não podem falhar viram
  índice, não `if`: é o `one_group_per_season` que garante um grupo por jogador
  por rodada mesmo com dois convites no mesmo instante.
- **REST simples, falado por `fetch`.** Sem SDK e sem código nativo: cada
  dependência nativa deste projeto já custou uma briga (a do AdMob custou uma
  versão de Kotlin), e o ranking não ia trazer outra. De quebra funciona na web
  e em qualquer build, inclusive Expo Go.

A identificação vai em dois cabeçalhos (`X-Player-Id`, `X-Player-Secret`), sem
token e sem sessão: o aparelho é a conta, o par já está na memória do jogo, e não
há *refresh* nem relógio para dar errado no meio de uma partida. O segredo é
guardado como hash — um vazamento do banco não entrega o direito de pontuar no
nome de ninguém.

Ponto só entra no ranking **fechando uma partida aberta no servidor** — a mesma
que desconta a vida e confere as moedas (seção seguinte). Não existe mais rota
que aceite um placar solto mandado pelo app.

### Ligando (uns 10 minutos)

**Na VPS**, pelo [Dokploy](https://dokploy.com): um serviço *Postgres* e uma
*Application* construída do [server/Dockerfile](server/Dockerfile) — Docker,
Traefik e Let's Encrypt já são dele, não há nada para instalar. O passo a passo,
com os campos de cada tela, está em [server/README.md](server/README.md).

**No jogo**: escreva o endereço do servidor em `DEFAULT_API_URL`, no topo de
[cloud.js](src/services/cloud.js), e gere um build novo — o endereço viaja
dentro dele.

Para desenvolver na sua máquina (ou numa VPS sem Dokploy), o
[docker-compose.yml](server/docker-compose.yml) sobe os dois containers direto:
`cp .env.example .env`, trocar a senha, `docker compose up -d --build`.

**Enquanto isso não é feito** (ou quando o jogador está sem internet), o jogo
abre no **modo treino**: dá para voar, mas sem moedas, vidas, loja nem ranking —
tudo isso só existe no servidor. Recorde e histórico continuam no aparelho.

> Isto substitui o ranking global do Google Play Jogos, que dependia de um
> módulo nativo em Kotlin que nunca foi escrito. A ponte antiga continua em
> [playGames.js](src/services/playGames.js), agora sem ninguém chamando.

---

## Moedas, loja e pássaros

Cada fase tem **moedas** no vão dos obstáculos — uma a cada três, em média, às
vezes fora do centro para pedir desvio. Fechar uma fase rende mais **10**. As
moedas compram, na **Loja**:

| Item | O que é | Como se consegue |
|---|---|---|
| **5 pássaros** | Geada, Brasa, Toxina, Fantasma e Cometa — só visual por enquanto | moedas (150 a 1.200, preços de teste) |
| **Escudo** | o anel que perdoa as batidas enquanto se dissipa | moedas ou vídeo premiado |
| **Nova chance** | ao cair, continuar do mesmo ponto — uma por partida | moedas ou vídeo premiado |

Escudo e nova chance comprados **ficam guardados** e são usados na hora certa: o
escudo, num botão antes do primeiro toque de cada fase (e no painel de fim de
fase); a nova chance, no painel que aparece quando o pássaro cai — com a
guardada, pagando em moedas ou assistindo a um vídeo ali mesmo.

### O servidor é a única fonte da verdade

**Nada disso é gravado no aparelho.** Moedas, vidas, escudos, novas chances e
pássaros moram no servidor ([server/](server/)); o app só mostra a última
resposta dele e não faz conta de saldo nem para adiantar o número na tela
([economy.js](src/services/economy.js)). Fechou o app, esqueceu — na próxima
abertura pergunta de novo.

Como uma partida vira moedas:

1. **Jogar** abre a partida no servidor. Ele desconta a vida e sorteia a
   **semente** que decide onde cada moeda aparece ([coins.js](src/game/coins.js)).
2. O jogo guarda o **número do obstáculo** de cada moeda pega — não só a
   contagem.
3. Ao fechar, o servidor refaz a conta com a semente e só credita moeda que
   existia naquele obstáculo, uma vez, até onde o jogador chegou; e recusa placar
   feito mais rápido do que o jogo permite. É a mesma função em Go e em JS, com
   os mesmos números de referência nos testes dos dois lados.

Prêmio de vídeo só sai com o **aviso assinado do Google** ao servidor (SSV do
AdMob): o anúncio carrega com o código do jogador, e o app troca o vídeo
confirmado pelo prêmio ([useAds.js](src/hooks/useAds.js)). Um app modificado não
consegue dizer "assisti" sozinho.

> **O limite honesto:** a física roda no celular. O servidor garante que ninguém
> ganha o que não existia — moeda fora da semente, placar impossível, prêmio sem
> vídeo, compra sem saldo —, mas não assiste ao voo. Um app adulterado que voe
> sozinho de forma plausível ainda passa. Cada mudança de saldo fica num
> livro-razão no banco para quando for preciso investigar
> ([server/README.md](server/README.md#de-onde-vieram-as-moedas-de-alguém)).

### Sem internet: modo treino

Sem servidor, a Home troca *Jogar* por **Treinar**: o voo é o mesmo, mas sem
moedas, vidas, escudo, nova chance, loja ou ranking — e a tela diz isso. Recorde
e *Seus voos* continuam funcionando, porque moram no aparelho e não são moeda de
troca.

### Os pássaros e as habilidades

O **desenho** de cada pássaro está em [birds.js](src/game/birds.js) (cores e
acessório: cristais, chamas, antena e máscara, visor, rastro) e é feito por
[BirdFigure.js](src/game/render/BirdFigure.js) — o mesmo na loja e no voo, só com
Views. **Nome, preço e habilidade vêm do servidor** ([catalog.go](server/catalog.go)):
mudar preço é redeploy do servidor, sem build nova do app.

As **habilidades** ainda não existem, mas a vaga está pronta: cada pássaro novo
chega do servidor com `ability: {id, status: "soon"}` (o de sempre, sem
habilidade, com `null`), a loja mostra *"em breve"*, e o mundo do jogo já chama os
ganchos da habilidade do pássaro escolhido — início de partida e de fase, cada
frame, moeda pega, batida, nova chance ([abilities.js](src/game/abilities.js)).
Se uma habilidade mexer em moeda ou pontuação, a regra também precisa entrar no
servidor, senão a conferência recusa o que ela rendeu.

---

## Rotação automática

Não há escolha de orientação: o app fica destravado (`ScreenOrientation.unlockAsync`)
e segue o aparelho. Todo o layout do jogo é derivado do tamanho da tela, então
girar apenas recalcula as medidas.

**Girar no meio de uma partida não custa o placar.** Como largura, altura, vão,
tamanho do pássaro e posição de todas as colunas mudam, o mundo é refeito do
zero — mas o placar atravessa a virada e o jogo volta ao estado "toque para
voar", em vez de deixar o pássaro cair numa tela que acabou de mudar de forma.
A regra está isolada em [session.js](src/game/session.js) e é coberta por testes.

Dois pontos que valem saber:

- Se a **rotação automática do sistema** estiver desligada, o Android não gira o
  app — é uma trava do sistema, não do jogo. Há um aviso sobre isso em Configurações.
- Como girar devolve o jogador ao estado "pronto", em tese dá para girar de
  propósito para escapar de uma coluna difícil. Para um jogo casual isso é
  preferível a punir quem mudou o jeito de segurar o celular; se o ranking
  competitivo pesar mais, trave a orientação enquanto a fase for `PLAYING`.

---

## Som

Os quatro áudios são **gerados por síntese**, não baixados: onda quadrada,
triangular e ruído, do jeito que um console 8-bit faria. Isso evita depender de
arquivo externo com licença.

```bash
npm run audio
```

Regera `assets/audio/` a partir de [tools/generate-audio.js](tools/generate-audio.js) —
mexa nas constantes de lá para mudar a trilha.

| Arquivo | O que é | Controlado por |
|---------|---------|----------------|
| `music.wav` | Loop de 16 s, Lá menor, 120 BPM | *Música de fundo* |
| `flap.wav` | O toque que faz o pássaro subir | *Som do toque* |
| `score.wav` | Ponto marcado | *Efeitos do jogo* |
| `hit.wav` | Colisão | *Efeitos do jogo* |

O toque pode se repetir mais rápido do que o som dura, então o `flap` usa um
rodízio de três players — com um só, cada toque cortaria o anterior.

---

## Icone e splash

As imagens do app tambem sao **desenhadas por script**, sem editor de imagem e sem
dependencia externa — o PNG e escrito na mao (cabecalho + IDAT comprimido com o
zlib do proprio Node) e as formas usam cobertura suavizada em 1 px.

```bash
npm run icons
```

| Arquivo | Para que serve |
|---------|----------------|
| `icon.png` (1024) | Icone do app |
| `adaptive-icon.png` (1024) | Primeiro plano do icone adaptativo do Android |
| `splash-icon.png` (512) | Logo da tela de abertura, sobre fundo transparente |
| `favicon.png` (64) | Aba do navegador |

`npm run assets` regera audio e imagens de uma vez.

> **Atencao ao mexer no `app.json`:** se a pasta `android/` existir, ela nao se
> atualiza sozinha. Rode `npx expo prebuild --platform android --clean` depois de
> qualquer mudanca de icone, splash, orientacao ou plugin — senao o Gradle falha
> com erros de recurso nao encontrado. `npx expo-doctor` avisa quando as duas
> pontas estao dessincronizadas.

---

## Ranking

### Aba "Seus voos" — funciona sempre

Histórico das 25 melhores partidas do aparelho, com data e orientação, salvo em
`AsyncStorage`. É a fonte do recorde mostrado no menu. Não precisa de conta nem
de internet.

### Abas "Individual" e "Grupo" — o servidor

Ranking da rodada da semana, com os pontos das partidas fechadas no servidor. Ver
[Grupos, rodadas e ranking](#grupos-rodadas-e-ranking).

> A primeira ideia de ranking global era o **Google Play Games Services**, que
> dependia de um módulo nativo em Kotlin nunca escrito. O servidor próprio o
> substituiu; a ponte antiga continua em [playGames.js](src/services/playGames.js),
> sem ninguém chamando.

---

## Fases e anúncios

Uma partida completa tem **500 obstáculos** — 5 fases de 100. A cada
**`STAGE_LENGTH` obstáculos** a fase fecha: o mundo congela, aparece o
painel de fim de fase e a partida continua na fase seguinte — cenário novo,
obstáculos novos e **+10% de velocidade** sobre a velocidade inicial.

```js
// src/game/constants.js
export const STAGE_LENGTH = 10; // TESTE. Em producao: 50.
```

Esse é o único número a mudar para sair do modo de teste.

### As 5 fases

| # | Fase | Velocidade | Cenário | Obstáculo |
|---|------|-----------|---------|-----------|
| 1 | Neon Dusk | 1,00x | crepúsculo roxo/laranja | coluna neon arredondada |
| 2 | Chuva Ciber | 1,15x | azul profundo, torres altas | vidro azul, topo chanfrado |
| 3 | Tempestade Solar | 1,30x | céu em brasa | chapa metálica com rebites |
| 4 | Selva Tóxica | 1,45x | verde tóxico, copas redondas | coluna orgânica |
| 5 | Circuito Vazio | 1,60x | vazio magenta | energia com núcleo brilhante |

Cada fase corre **15% mais** que a velocidade base (multiplicador absoluto, não
composto: a fase 5 é exatamente 60% mais rápida que a 1).

### Zerar o jogo

Fechar a **fase 5** troca o painel de fim de fase por um de conclusão: cinco
estrelas, "Você zerou o Major Flyer", o total de obstáculos e o recorde. Dali o
jogador escolhe **Continuar voando** (o jogo segue no ritmo da fase 5, com o
placar correndo) ou volta ao **Menu**.

O parabéns aparece **uma vez só**: a condição é ter fechado exatamente a última
fase da tabela (`stageIndex + 1 === STAGE_COUNT`). Da fase 6 em diante volta o
painel de sempre — comemoração que se repete a cada 100 obstáculos não é
comemoração, é ruído.

### As armadilhas

Cada fase apresenta **uma mecânica nova, sozinha** — ela tem tempo de ser
aprendida antes da próxima. A última junta tudo.

| Fase | Gelo | Gravidade | Vão que se mexe |
|---|---|---|---|
| 1 | — | — | — |
| 2 | ✅ | — | — |
| 3 | — | ✅ | — |
| 4 | — | — | ✅ |
| 5 | ✅ | ✅ | ✅ |

**Fase 2 — cubos de gelo.** Armadilha *de obstáculo*. Pouco mais da metade das
colunas a traz. O cano sorteado (às vezes o de cima, às vezes o de baixo — nunca
dá para decorar) **pisca em vermelho ~1,2 s antes**, e então o bloco de gelo sai
da ponta e come **15% do vão**. O aviso apaga quando o gelo aparece: dali em
diante o perigo está à vista, e continuar piscando só poluiria a tela.

O gelo não é um corpo novo no motor de física: ele empurra a borda daquele lado
para dentro do vão, então a colisão já o enxerga de graça.

**Fase 3 — gravidade aumentada.** Esta **não é de obstáculo nenhum**: vale para
a fase inteira enquanto dura. O ciclo tem três tempos:

1. **Aviso (2 s)** — uma seta vermelha para baixo aparece no canto superior
   direito, piscando. A gravidade ainda é a de sempre.
2. **Peso (3 a 5 s)** — a seta some, a gravidade **dobra** e o **topo da tela
   pisca em vermelho**. O impulso do toque não muda; o que muda é que ele passa
   a levantar metade do que levantava, e o jogador precisa tocar bem mais.
3. **Folga (5 a 11 s)** — tudo volta ao normal até a próxima rodada.

O aviso vem **antes**, e não junto, por um motivo de justiça: dobrar a gravidade
de surpresa no meio de uma passagem apertada é morte sem chance de reagir. E
fica no canto, não sobre um cano, porque marcar um obstáculo diria a coisa
errada — o jogador procuraria a armadilha *naquela* coluna.

**Fase 4 — o vão que se mexe.** O par inteiro desliza na vertical **mantendo o
tamanho do vão**: o cano de cima cresce exatamente o que o de baixo encolhe. O
jogador não perde espaço — perde a certeza de onde a passagem vai estar, e não
dá mais para decorar a altura.

**O movimento acontece na tela, à vista.** A coluna começa a deslizar no frame
em que **entra pela direita** e para quando chega a **1 segundo de viagem** do
pássaro (`DRIFT_SAFE_SECONDS`). São os dois lados do mesmo acordo: dá para ver a
armadilha acontecer, e ainda sobra um segundo inteiro com a coluna parada para
se posicionar. Se o jogador alcançar uma que ainda desliza, ela **para onde
estiver** — o vão é válido em qualquer ponto do caminho.

Enquanto desliza, o cano **acende** na cor clara dele mesmo. Não é o vermelho
das outras armadilhas de propósito: aqui não há perigo novo, o vão continua do
mesmo tamanho. O brilho só serve para o olho achar a coluna certa numa tela em
que tudo já se move.

O movimento leva ~0,6 s, cerca de 80% das colunas se mexem, e o deslocamento
nunca é menor que 28% da faixa útil — movimento pequeno demais ninguém nota, e a
armadilha viraria só um sorteio de altura diferente.

> **Por que distância, e não contagem de obstáculos.** A primeira versão dizia
> "só mexe em coluna que esteja a dois obstáculos de distância", e a armadilha
> ficou invisível. O motivo é geométrico: quando o pássaro cruza uma coluna, a
> seguinte já está a *dois* espaçamentos, e cabe pouco mais de **uma** coluna na
> tela à frente dele. Contar obstáculos nunca ia colocar o movimento no quadro.
>
> Agora `npm test` roda uma partida inteira na fase 4 e conta, frame a frame,
> onde as colunas estavam quando deslizaram: **3052 de 3052 frames dentro da
> tela**. Na versão anterior, esse mesmo teste dava 0 de 408.

Os tempos do gelo são contados em **segundos de distância**, não em pixels:
assim o aviso dura o mesmo tanto em qualquer fase — quanto mais rápida a coluna
vem, mais longe ela começa a piscar. Tudo isso vive em
[constants.js](src/game/constants.js), e quais fases têm o quê está na coluna
`traps` de [stages.js](src/game/stages.js).

Passou da fase 5? A contagem de fases continua (e o anúncio também), mas o
visual e a velocidade **param de subir** — senão vira injogável.

Fase é só dado: tudo vive em [`src/game/stages.js`](src/game/stages.js), numa
tabela de cores e medidas. Para inventar uma fase 6, acrescente um item na
lista — não existe `if` de fase espalhado pelo código.

### Os anúncios

O jogo mostra **um único formato: o vídeo premiado**, e sempre por escolha do
jogador. É o que a política do AdMob pede — *vídeo premiado exige que a pessoa
escolha assistir e receba algo em troca* — e é também o formato de maior eCPM.

Onde ele aparece, e o que rende:

| Onde | Prêmio |
|---|---|
| Painel de fim de fase | um **escudo**, usado na hora |
| Painel de queda | a **nova chance**, usada na hora |
| Home ou fim de jogo, sem vidas | as **5 vidas** de volta |
| Loja | um escudo ou uma nova chance **guardados** |

O escudo (anel azul em volta do pássaro) **não some no impacto**: começa a se
dissipar, pisca e leva ~1,5 s para apagar — e *enquanto ainda houver anel na tela
toda colisão continua sendo perdoada*, seja a outra coluna do mesmo par, a
seguinte ou o chão. O tempo está em `SHIELD_FADE_FRAMES`
([constants.js](src/game/constants.js)).

Recusar é sempre de graça: **Continuar sem escudo** vai direto para a fase
seguinte e **Encerrar voo** fecha a partida, sem anúncio nenhum. Propaganda para
quem acabou de dizer "não quero" é a maneira mais rápida de perder o jogador.

**O prêmio só existe quando o servidor confirma.** O vídeo carrega com o código
do jogador; quando termina, o Google avisa o servidor, e o app troca o vídeo
confirmado pelo prêmio — tentando por alguns segundos enquanto o aviso não chega
(a tela mostra *"Confirmando o prêmio..."*). Por isso a verificação do lado do
servidor precisa estar ligada nas unidades premiadas do AdMob
([server/README.md](server/README.md#7-a-verificação-dos-anúncios)).

O vídeo começa a **carregar antes do clique** (quando a fase fecha e quando o
pássaro cai): anúncio que só carrega na hora faz o jogador apertar o botão e não
ver nada acontecer.

> **E o intersticial?** A unidade está cadastrada nas duas plataformas e
> `showInterstitial()` está implementado em [ads.js](src/services/ads.js), mas
> **nada no jogo o chama**.

### As 5 vidas

O jogador tem **5 vidas**, e cada partida custa uma — descontada **pelo
servidor** no instante em que ela abre. Os cinco pássaros abaixo do recorde
mostram quantas restam; a vida gasta **não some da fileira**, fica transparente.

Zerou, o botão principal vira **Assistir e ganhar 5 vidas**, na Home e no painel
de fim de jogo.

O que vale saber:

- **Nenhum número de vida mora no aparelho.** A Home busca a carteira no
  servidor toda vez que aparece, e a partida só começa com a resposta dele na mão.
  Fechar e abrir o app, ou mexer em arquivo, não devolve vida nenhuma.
- **Nova chance não gasta vida**: ela continua a mesma partida. Girar o aparelho
  também não — nem no meio do voo, nem no painel da nova chance.
- **Sem vídeo não há recarga.** Antes, quando o anúncio não carregava, as vidas
  saíam assim mesmo; com o prêmio exigindo a confirmação do Google, isso viraria
  vida infinita para quem bloqueia anúncio. Sem internet, sobra o modo treino.
- O número de vidas e os preços estão em [catalog.go](server/catalog.go).

**O jogo nunca trava esperando anúncio.** Sem SDK, sem IDs ou sem rede, as
funções respondem "não deu" na hora. Em desenvolvimento, sem AdMob, o botão roda
uma *propaganda simulada* de 3 s — e o prêmio dela só sai num servidor com
`ADS_DEV_AUTOVERIFY=true`, porque o Google não confirma vídeo que não existiu.

### AdMob: o que já está ligado

A conta existe e as duas plataformas estão configuradas:

| Plataforma | O quê | ID |
|---|---|---|
| Android | App ID | `ca-app-pub-6744388004633498~5213266367` |
| Android | Rewarded | `ca-app-pub-6744388004633498/7044011331` |
| Android | Intersticial | `ca-app-pub-6744388004633498/9670174671` |
| iOS | App ID | `ca-app-pub-6744388004633498~9033091878` |
| iOS | Rewarded | `ca-app-pub-6744388004633498/7720010204` |
| iOS | Intersticial | `ca-app-pub-6744388004633498/1651199370` |

Os **App IDs** ficam no `app.json` (props do plugin) porque quem precisa deles é
o código **nativo**: viram `<meta-data>` no `AndroidManifest.xml` e
`GADApplicationIdentifier` no `Info.plist` durante o `prebuild`. As **unidades**
ficam no JS, em `AD_UNITS`.

**Teste em dev, real em produção.** `USE_TEST_UNITS = __DEV__`: todo `expo start`
e toda build de debug mostram a unidade de teste do Google, e só a build de
release mostra o anúncio de verdade. Isso não é preciosismo — **clicar num
anúncio real do próprio app é o jeito mais rápido de o AdMob suspender a conta**,
e é exatamente o que acontece quando se testa clicando.

Uma trava a mais: quando uma plataforma não tem unidade real cadastrada para um
formato, `unitId()` responde vazio **mesmo em modo de teste** — é o que hoje
mantém o banner (que o jogo não usa) fora do ar, e o que impediu, antes de o iOS
ter App ID, que o SDK nativo fosse inicializado sem `GADApplicationIdentifier`,
o que derruba o app na abertura.

**A propaganda simulada também é só de desenvolvimento**
(`SIMULATE_WHEN_UNAVAILABLE = __DEV__`). Ela é uma tela de anúncio que não é
anúncio nenhum: útil para testar o fluxo no navegador, indefensável para quem
baixou o jogo. Em produção, formato que não existe simplesmente não aparece — a
fase troca direto.

**Falta um passo no AdMob: a verificação do lado do servidor** nas duas unidades
premiadas, apontando para `https://<seu-servidor>/v1/ads/ssv`. Sem ela, quem
assiste a um vídeo não recebe o prêmio — o passo a passo está em
[server/README.md](server/README.md#7-a-verificação-dos-anúncios). Para o iPhone
falta também a build — `eas build --platform ios`, já que iOS não compila no
Windows.

Depois de mexer no App ID ou nos plugins do `app.json`, o projeto nativo precisa
ser refeito — é lá que o App ID vira `<meta-data>` no manifesto:

```bash
npx expo prebuild --clean
```

Anúncio é código nativo: **não roda no Expo Go nem na web**. Nessas duas
situações o app cai na propaganda simulada, e o jogo segue igual.

Referência de receita (BR, aproximada): banner US$ 0,10–0,50 · intersticial
US$ 1–4 · premiado US$ 3–9 de eCPM.

### Kotlin: por que a versão do SDK de anúncios está fixa

Instalar o SDK de anúncios quebrava a build Android com dezenas de linhas assim:

> `Module was compiled with an incompatible version of Kotlin. The binary version
> of its metadata is 2.3.0, expected version is 2.1.0.`

O React Native 0.86 compila com **Kotlin 2.1.20**, e **um compilador não lê
metadata de versão maior que a sua** (o contrário funciona: compilador novo lê
binário antigo). O Google vem publicando o `play-services-ads` compilado com
Kotlin cada vez mais novo — lendo o cabeçalho dos `.kotlin_module` dentro dos
próprios `.aar`:

| `play-services-ads` | metadata Kotlin | vem com |
|---|---|---|
| 23.6.0 | 1.9.0 | — |
| 24.0.0 – 24.5.0 | 2.1.0 | — |
| 24.9.0 | 2.2.0 | RNGMA 16.0.3 |
| **25.0.0** | **2.2.0** | **RNGMA 16.1.0 – 16.3.4** |
| 25.4.0 | 2.3.0 | RNGMA 16.4.0+ |

E subir o Kotlin até 2.3 **não é opção**: o Expo SDK 57 só conhece KSP até
**Kotlin 2.2.21** (`KSPLookup` em `expo-modules-autolinking`). Com 2.3.21 o
build morre em `expo-modules-core` e `react-native-safe-area-context` com
*Internal compiler error* — testado.

Daí a combinação que está no projeto, a mais nova que fecha dos dois lados:

- `"react-native-google-mobile-ads": "16.3.4"` — **sem `^`, de propósito**: a
  16.4.0 puxa o `play-services-ads` 25.4.0 e quebra tudo de novo.
- `kotlinVersion: "2.2.21"` via `expo-build-properties` no [app.json](app.json),
  que vira `android.kotlinVersion` no `gradle.properties` gerado.

```json
["expo-build-properties", { "android": { "kotlinVersion": "2.2.21" } }]
```

**Quando dá para atualizar o SDK de anúncios:** quando o Expo passar a suportar
Kotlin 2.3 (basta a chave `"2.3.x"` aparecer no `KSPLookup`). Aí é subir os dois
juntos — o SDK e o `kotlinVersion` — nunca só um.

---

### R8: app menor e crash legível

A build de release passa pelo **R8** (`enableMinifyInReleaseBuilds` nas props do
`expo-build-properties`, no [app.json](app.json)). São dois ganhos:

- o app encolhe — R8 remove classes e métodos que ninguém chama;
- o AAB passa a levar o **arquivo de desofuscação** dentro dele
  (`BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`), que é o
  que a Play Console pedia para conseguir mostrar stack trace legível em falhas
  e ANRs. Não precisa subir nada à mão: o Gradle empacota junto.

O mapping e os símbolos nativos **não vão para o aparelho de ninguém** — a Play
Store usa esses metadados só do lado dela, e por isso o AAB parece grande
enquanto o download real continua pequeno.

**Ao mexer nisso, teste a build de release antes de publicar.** R8 renomeia e
remove código, e biblioteca que usa reflexão pode quebrar só em produção. As
libs do projeto trazem as próprias regras (`consumer-rules.pro`), então o
caminho normal funciona — mas se algo sumir em release e não em debug, é aqui
que se olha primeiro: acrescente a regra em `extraProguardRules`, nas mesmas
props do plugin.

---

## Como está montado

```
App.js                       navegacao entre as telas, audio e orientacao livre
src/
  audio/AudioManager.js      players de som, fora do React de proposito
  game/
    constants.js             passo fixo de 60 Hz e estados do jogo
    layout.js                todas as medidas derivadas do tamanho da tela
    stages.js                tabela das 5 fases: cores, formas e velocidade
    World.js                 motor de fisica (matter-js): gravidade, colisoes e moedas
    coins.js                 onde ficam as moedas (a mesma conta do servidor)
    birds.js                 o visual de cada passaro
    abilities.js             a vaga das habilidades dos passaros
    session.js               o que sobrevive a uma rotacao no meio da partida
    render/                  ceu, passaro, moeda, colunas, chao e placar (so Views)
  screens/
    HomeScreen.js            Jogar ou Treinar / Loja / Ranking / Configuracoes
    GameScreen.js            game loop, HUD, escudo, nova chance e fim de jogo
    ShopScreen.js            passaros, escudos e novas chances
    LeaderboardScreen.js     abas Individual, Grupo e Seus voos
    SettingsScreen.js        som, jogador e dados
  services/
    scores.js                historico local de partidas
    identity.js              codigo publico + segredo do jogador, e o apelido
    season.js                a rodada da semana (domingo 20h -> domingo 18h)
    cloud.js                 transporte, grupos e ranking; sem endereco, "offline"
    economy.js               moedas, vidas, itens e partidas: so memoria, o servidor manda
    playGames.js             ponte antiga com o Play Jogos (sem uso hoje)
    ads.js                   AdMob (premiado com o codigo do jogador), opcional
    adsSdk.js                carrega o SDK nativo (.web.js devolve null)
  state/SettingsContext.js   preferencias persistidas
  hooks/
    useScores.js             recorde + historico local
    useEconomy.js            a carteira, para as telas redesenharem
    useAds.js                o video premiado e o premio confirmado no servidor
    usePlayer.js             o jogador deste aparelho, para as telas
  ui/                        tema, botao, passaros de vida e da loja, cobertura do anuncio
server/                      o servidor do jogo (Go + Postgres, docker)
  main.go                    configuracao, subida e encerramento limpo
  api.go                     rotas de conta, grupos e ranking
  api_economy.go             rotas de partida, loja e anuncios
  store.go                   regras e consultas de conta, grupos e ranking
  economy.go                 carteira, partidas, loja e premios (com livro-razao)
  catalog.go                 passaros, precos e regras da economia
  coins.go                   a conta das moedas, igual a do app
  ssv.go                     a verificacao do anuncio premiado pelo Google
  season.go                  a rodada da semana, igual a do app
  schema.sql                 tabelas e indices (rodam sozinhos na subida)
  docker-compose.yml         API + Postgres, para rodar fora do Dokploy
  docker-compose.dokploy.yml o mesmo, no formato do Dokploy (sem portas abertas)
tools/
  generate-audio.js          sintetiza assets/audio
  generate-icons.js          desenha icone, splash e favicon
  selftest.js                fisica, proporcao, rotacao, moedas e a conversa com o servidor
```

### Física

O `World` cria um `Matter.Engine` de verdade:

- O pássaro é um **corpo dinâmico** (círculo). A queda vem da gravidade do
  próprio motor; o toque aplica `Body.setVelocity` com um impulso para cima.
- As colunas são **corpos estáticos com `isSensor: true`**. O matter-js detecta o
  contato e dispara `collisionStart` (é assim que o jogo sabe que você bateu),
  mas não empurra o pássaro.
- O loop roda com **passo fixo de 16,67 ms e acumulador**. A simulação fica
  idêntica em 60 Hz, 90 Hz ou 120 Hz, e o jogo não "teleporta" ao voltar do
  segundo plano.

### Por que fica igual em qualquer tela

Nada é fixo em pixels. `layout.js` deriva tudo em cadeia, começando pelo vão:

| Medida | Base |
|--------|------|
| Vão entre colunas | 31% da altura útil (retrato) / 40% (paisagem) |
| Tamanho do pássaro | `vão / 5.5` — a razão é **fixa** |
| Largura da coluna | `3,4 ×` o diâmetro do pássaro |
| Gravidade | `altura * 0.00078` px/frame² |
| Impulso do toque | `-sqrt(2 * gravidade * vão * 0.48)` |
| Velocidade | `largura / 190` px/frame |

O ponto central: **o pássaro é medido a partir do vão, não da tela**. Sem isso,
em paisagem sobra pouca altura e o pássaro fica grande demais para o vão — a
primeira versão dava 6,2× em retrato contra 3,5× em paisagem, ou seja, dois jogos
de dificuldades bem diferentes. Agora a razão é 5,5× em todos os formatos, e
`npm test` verifica isso em seis tamanhos de tela.

Pelo mesmo motivo o impulso do toque é derivado da gravidade e do vão: um toque
sempre ganha 48% do vão em altura, e o ápice sempre chega em ~0,33 s. A altura
sorteada de um vão para o próximo também é limitada (62% da faixa possível), para
o jogo não pedir um mergulho do teto ao chão entre duas colunas.

### Performance

O game loop escreve em `Animated.Value`, não em `setState`. O React só
re-renderiza quando o estado do jogo muda — os 60 fps vão direto para as views
nativas.

**O placar é atualizado no frame do ponto.** Duas coisas garantem isso:

1. O ponto vale quando o pássaro **emerge** da coluna (o bico passa a borda
   direita dela). A regra anterior esperava a coluna passar pela *cauda*, o que
   custava `2 × raio ÷ velocidade` frames — 0,33 s de placar atrasado num
   iPhone em retrato. `npm test` mede essa folga em duas telas.
2. **O número não passa pelo React.** Isolar o placar num componente próprio e
   chamá-lo por `ref` resolveu na web e **não resolveu no Android**: lá o som
   saía na hora e o número aparecia segundos depois. O commit do React entra na
   fila atrás do game loop, que naquele mesmo frame já empurrou uns vinte
   valores animados — e reconciliar a árvore do jogo no celular custa muito mais
   do que trocar um nó de texto no navegador.

   A saída foi desenhar o placar como **rolo de dígitos**
   ([ScoreDigits.js](src/game/render/ScoreDigits.js)): cada casa é uma coluna
   com os dez algarismos empilhados, e mudar o número é mover um `translateY`.
   O placar passou a andar pelo mesmo caminho do pássaro e das colunas — o
   único que já chegava em dia.

---

## Controles

| Ação | Resultado |
|------|-----------|
| Toque na tela | Bate as asas / começa a partida |
| Botão **Pausar** | Congela a simulação |
| App vai pro fundo | Pausa sozinho e silencia |
| Girar o aparelho | Adapta a tela, mantendo o placar |
| Cair | Oferta de nova chance (quando há como pagar), depois o resultado |
| Tela de resultado | Toque (após 0,65 s) começa outra partida — se houver vida |

A dificuldade agora vem das **fases** (seção abaixo), e não mais de uma rampa
ligada ao placar.

---

## Próximos passos possíveis

- Conquistas.
- `STAGE_LENGTH` de 10 para 50 quando a troca de fase estiver aprovada.
- Fases 6+ (é só mais um item em `src/game/stages.js`).
- Vibração no impacto (`expo-haptics`).
- Habilidades dos pássaros — o lugar já existe em [abilities.js](src/game/abilities.js).
- Recuperar a conta ao trocar de aparelho (login Google/Apple): hoje moedas e
  pássaros ficam presos ao código do aparelho.
- Revisar a política de privacidade em `privacidade/` — ela ainda descreve um
  jogo sem servidor.
- Build instalável: `npx expo prebuild` + `eas build -p android --profile preview`.

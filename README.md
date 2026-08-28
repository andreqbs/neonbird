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

---

## Telas

| Tela | O que tem |
|------|-----------|
| **Início** | Jogar, Ranking, Configurações, o recorde do aparelho e as 5 partidas |
| **Ranking** | Aba *Global* (Google Play Jogos) e aba *Seus voos* (histórico local) |
| **Configurações** | Música de fundo, som do toque, efeitos, conta do Play Jogos, apagar recordes |
| **Jogo** | Partida, placar ao vivo, pausa e fim de jogo |

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

### Aba "Global" — precisa de uma build própria

Ranking com outros jogadores da Play Store é **Google Play Games Services**, que
é código nativo Android. Ele **não existe e não pode existir no Expo Go**: seria
preciso que o Expo Go fosse o *seu* jogo, registrado no *seu* Play Console, com a
*sua* assinatura.

Por isso o app trata o módulo nativo como **opcional**
([playGames.js](src/services/playGames.js) usa `requireOptionalNativeModule`).
Sem ele, tudo funciona com o ranking local e a interface diz exatamente o que
falta — nada de tela quebrada nem de nomes inventados.

Para ligar de verdade:

1. No **Google Play Console**, registre o jogo em *Play Games Services*, crie as
   credenciais OAuth com o SHA-1 da sua chave de assinatura e crie um
   **leaderboard**. Guarde o ID (`CgkI…`).
2. Crie o módulo nativo:
   ```bash
   npx create-expo-module --local major-flyer-play-games
   ```
3. No Kotlin do módulo, use `com.google.android.gms:play-services-games-v2` e
   exponha os métodos do **contrato** documentado no topo de
   [playGames.js](src/services/playGames.js) (`signInAsync`, `getPlayerAsync`,
   `submitScoreAsync`, `loadTopScoresAsync`, `showLeaderboardAsync`). Registre o
   módulo com o nome `MajorFlyerPlayGames`.
4. Cole o ID do leaderboard em `LEADERBOARD_ID`, no mesmo arquivo.
5. Gere a build — a partir daqui não roda mais no Expo Go:
   ```bash
   npx expo prebuild
   ```
   ```bash
   eas build -p android --profile preview
   ```

Nada mais no app precisa mudar: as telas de Ranking e Configurações já leem o
estado real e trocam de conteúdo sozinhas.

**Sobre "associar à Play Store":** com o Play Games v2 o login é **automático**
quando o jogo abre, então não existe login obrigatório. O botão em Configurações
serve para quem recusou o automático ou quer trocar de conta — por isso ele está
lá, e não numa tela de abertura.

---

## Fases e anúncios

A cada **`STAGE_LENGTH` obstáculos** a fase fecha: o mundo congela, aparece o
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
| 1 | Neon Dusk | 1,0x | crepúsculo roxo/laranja | coluna neon arredondada |
| 2 | Chuva Ciber | 1,1x | azul profundo, torres altas | vidro azul, topo chanfrado |
| 3 | Tempestade Solar | 1,2x | céu em brasa | chapa metálica com rebites |
| 4 | Selva Tóxica | 1,3x | verde tóxico, copas redondas | coluna orgânica |
| 5 | Circuito Vazio | 1,4x | vazio magenta | energia com núcleo brilhante |

Passou da fase 5? A contagem de fases continua (e o anúncio também), mas o
visual e a velocidade **param de subir** — senão vira injogável.

Fase é só dado: tudo vive em [`src/game/stages.js`](src/game/stages.js), numa
tabela de cores e medidas. Para inventar uma fase 6, acrescente um item na
lista — não existe `if` de fase espalhado pelo código.

### Os anúncios

Uma regra do AdMob molda a tela: **vídeo premiado exige que o jogador escolha
assistir e receba algo em troca** — obrigar a ver para continuar é violação de
política, e o formato certo para pausa obrigatória é o **intersticial**.

Daí a divisão: **premiado onde há prêmio, intersticial na virada de fase**.

O painel de fim de fase tem duas saídas, e **cada fase mostra um anúncio, nunca
dois**:

- **Assistir e ganhar escudo** — vídeo premiado; a recompensa é um escudo (anel
  azul em volta do pássaro) que perdoa a batida seguinte. Ele **não some no
  impacto**: começa a se dissipar, pisca e leva ~1,5 s para apagar — e
  *enquanto ainda houver anel na tela toda colisão continua sendo perdoada*, seja
  a outra coluna do mesmo par, a coluna seguinte ou o chão. O tempo está em
  `SHIELD_FADE_FRAMES` ([constants.js](src/game/constants.js)).
- **Continuar sem prêmio** — entra o **intersticial** e a fase vira. É a pausa
  natural do jogo (fase fechada, jogador parado, painel na tela), que é
  exatamente onde a política do AdMob quer esse formato — e nunca por cima de um
  toque dado esperando outra coisa.

Quem assiste ao premiado **não** leva o intersticial em seguida: dois anúncios
seguidos é o caminho curto para a desinstalação, e o premiado paga mais. Para
cobrar os dois, é um `await showInterstitial()` antes do `advanceStage` em
`watchAd` ([GameScreen.js](src/screens/GameScreen.js)).

Os dois formatos começam a **carregar quando a fase fecha**, não no clique:
anúncio que só carrega na hora faz o jogador apertar o botão e não ver nada
acontecer. Se mesmo assim não estiver pronto, a fase avança sem anúncio — o jogo
nunca fica esperando.

### As 5 partidas

O jogador começa com **5 partidas**. Cada partida iniciada — pelo *Jogar* da
Home ou pelo *Jogar de novo* do fim de jogo — apaga um dos cinco pássaros que
ficam logo abaixo do recorde. O pássaro gasto **não some da fileira**: fica
transparente, senão o jogador não teria como saber quantas ele tinha.

Zerou, o botão principal vira **Assistir e ganhar 5 vidas** (vídeo premiado),
tanto na Home quanto no painel de fim de jogo.

O que vale saber:

- **O número vive na memória** ([lives.js](src/services/lives.js)), e o disco
  (`@major-flyer/lives`) só guarda entre uma sessão e outra — sem isso, fechar e
  abrir o app seria a maneira mais fácil de jogar para sempre.

  A ordem importa: gastar e recarregar valem **na hora**, e a gravação vai
  atrás numa fila. Quando era o contrário — cada mudança esperando uma ida e
  volta ao AsyncStorage para só então voltar à tela por props —, dava para
  assistir ao vídeo, ganhar as cinco vidas, começar outra partida e o painel
  ainda marcar cinco. No Android, com a thread de JS ocupada pelo jogo, esse
  atraso passava de segundos.
- Pela mesma razão, **as vidas não viajam por props**: cada tela lê o serviço
  direto (`livesNow()` para decidir, `useLives()` para redesenhar). Um número
  que atravessa três componentes chega tarde justamente quando importa.
- **Girar o aparelho não cobra outra vida**: a remontagem da tela não passa por
  nenhum dos dois caminhos de entrada de uma partida.
- Sem SDK, sem IDs ou na web não existe vídeo nenhum — e nesse caso a recarga
  sai assim mesmo. Anúncio não pode ser a única porta de saída de uma tela.
- `MAX_LIVES` está em [lives.js](src/services/lives.js), e `npm test` cobre a
  regra: não passa de zero por baixo nem de cinco por cima, e valor corrompido
  no disco não tranca ninguém.

`showInterstitial()` já está implementado em
[`src/services/ads.js`](src/services/ads.js) para quando/se a pausa obrigatória
for o caminho.

**O jogo nunca depende do anúncio.** Sem SDK, sem IDs ou sem rede, as funções
respondem "não deu" na hora e a fase avança. Enquanto não houver AdMob
configurado, o botão roda uma *propaganda simulada* de 3 s — só para dar para
testar o fluxo inteiro (desligue em `SIMULATE_WHEN_UNAVAILABLE`).

### AdMob: o que já está ligado

A conta existe e as duas plataformas estão configuradas:

| Plataforma | O quê | ID |
|---|---|---|
| Android | App ID | `ca-app-pub-6744388004633498~5213266367` |
| Android | Rewarded | `ca-app-pub-6744388004633498/7044011331` |
| Android | Intersticial | `ca-app-pub-6744388004633498/9670174671` |
| iOS | App ID | `ca-app-pub-6744388004633498~9033091878` |
| iOS | Rewarded | `ca-app-pub-6744388004633498/7720010204` |
| iOS | Intersticial | *ainda não criado no AdMob* |

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
formato, `unitId()` responde vazio **mesmo em modo de teste**. É o que faz o
intersticial do iOS não existir hoje em vez de tentar usar a unidade de teste
num app que ainda não tem esse bloco. E foi o que impediu, antes de o iOS ter
App ID, que o SDK nativo fosse inicializado sem `GADApplicationIdentifier` — o
que derruba o app na abertura.

**A propaganda simulada também é só de desenvolvimento**
(`SIMULATE_WHEN_UNAVAILABLE = __DEV__`). Ela é uma tela de anúncio que não é
anúncio nenhum: útil para testar o fluxo no navegador, indefensável para quem
baixou o jogo. Em produção, formato que não existe simplesmente não aparece — a
fase troca direto.

**Falta para o iOS:** criar o bloco **intersticial** no AdMob e colar em
`AD_UNITS.ios.interstitial`. Sem ele, a troca de fase no iPhone acontece sem
anúncio; o escudo e as vidas, que são premiados, funcionam normalmente.

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

## Como está montado

```
App.js                       navegacao entre as telas, audio e orientacao livre
src/
  audio/AudioManager.js      players de som, fora do React de proposito
  game/
    constants.js             passo fixo de 60 Hz e estados do jogo
    layout.js                todas as medidas derivadas do tamanho da tela
    stages.js                tabela das 5 fases: cores, formas e velocidade
    World.js                 motor de fisica (matter-js): gravidade e colisoes
    session.js               o que sobrevive a uma rotacao no meio da partida
    render/                  ceu, passaro, colunas, chao e placar (so Views)
  screens/
    HomeScreen.js            Jogar / Ranking / Configuracoes
    GameScreen.js            game loop, HUD, pausa e fim de jogo
    LeaderboardScreen.js     abas Global e Seus voos
    SettingsScreen.js        som, conta e dados
  services/
    scores.js                historico local de partidas
    lives.js                 as 5 partidas, gravadas no disco
    playGames.js             ponte opcional com o Google Play Jogos
    ads.js                   AdMob (premiado/intersticial), desligavel e opcional
    adsSdk.js                carrega o SDK nativo (.web.js devolve null)
  state/SettingsContext.js   preferencias persistidas
  hooks/
    useScores.js             recorde + envio de placar
    useLives.js              gasta e repoe vidas, sempre lendo o disco antes
    useAds.js                premiado e intersticial vistos pela tela
  ui/                        tema, botao, passaros de vida, cobertura do anuncio
tools/
  generate-audio.js          sintetiza assets/audio
  generate-icons.js          desenha icone, splash e favicon
  selftest.js                testes de fisica, proporcao e rotacao
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
| Tela de fim de jogo | Toque (após 0,65 s) reinicia |

A dificuldade agora vem das **fases** (seção abaixo), e não mais de uma rampa
ligada ao placar.

---

## Próximos passos possíveis

- Módulo nativo do Play Jogos (roteiro acima) e conquistas.
- `STAGE_LENGTH` de 10 para 50 quando a troca de fase estiver aprovada.
- Fases 6+ (é só mais um item em `src/game/stages.js`).
- Vibração no impacto (`expo-haptics`).
- Skins do pássaro liberadas por pontuação.
- Build instalável: `npx expo prebuild` + `eas build -p android --profile preview`.

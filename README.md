# Neon Flyer

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
| **Início** | Jogar, Ranking, Configurações e o recorde do aparelho |
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
   npx create-expo-module --local neon-flyer-play-games
   ```
3. No Kotlin do módulo, use `com.google.android.gms:play-services-games-v2` e
   exponha os métodos do **contrato** documentado no topo de
   [playGames.js](src/services/playGames.js) (`signInAsync`, `getPlayerAsync`,
   `submitScoreAsync`, `loadTopScoresAsync`, `showLeaderboardAsync`). Registre o
   módulo com o nome `NeonFlyerPlayGames`.
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

## Como está montado

```
App.js                       navegacao entre as telas, audio e orientacao livre
src/
  audio/AudioManager.js      players de som, fora do React de proposito
  game/
    constants.js             passo fixo de 60 Hz e estados do jogo
    layout.js                todas as medidas derivadas do tamanho da tela
    World.js                 motor de fisica (matter-js): gravidade e colisoes
    session.js               o que sobrevive a uma rotacao no meio da partida
    render/                  ceu, passaro, colunas e chao (so Views)
  screens/
    HomeScreen.js            Jogar / Ranking / Configuracoes
    GameScreen.js            game loop, HUD, pausa e fim de jogo
    LeaderboardScreen.js     abas Global e Seus voos
    SettingsScreen.js        som, conta e dados
  services/
    scores.js                historico local de partidas
    playGames.js             ponte opcional com o Google Play Jogos
  state/SettingsContext.js   preferencias persistidas
  hooks/useScores.js         recorde + envio de placar
  ui/                        tema, botao, moldura de tela e linhas de ajuste
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
re-renderiza quando o placar ou o estado do jogo muda — os 60 fps vão direto para
as views nativas.

---

## Controles

| Ação | Resultado |
|------|-----------|
| Toque na tela | Bate as asas / começa a partida |
| Botão **Pausar** | Congela a simulação |
| App vai pro fundo | Pausa sozinho e silencia |
| Girar o aparelho | Adapta a tela, mantendo o placar |
| Tela de fim de jogo | Toque (após 0,65 s) reinicia |

Dificuldade sobe até 40 pontos: a velocidade aumenta ~55% e o vão fecha ~14%.

---

## Próximos passos possíveis

- Módulo nativo do Play Jogos (roteiro acima) e conquistas.
- Vibração no impacto (`expo-haptics`).
- Skins do pássaro liberadas por pontuação.
- Build instalável: `npx expo prebuild` + `eas build -p android --profile preview`.

/**
 * Testes do nucleo do jogo, rodando no Node — sem emulador, sem celular.
 *
 *   npm test
 *
 * Da para testar de verdade porque a fisica e o layout vivem em modulos puros,
 * sem React: `computeLayout` so faz conta, e `World` so precisa do matter-js.
 * Os testes cobrem tres coisas que quebram calado num jogo:
 *
 *   1. Proporcao — a dificuldade tem que ser a mesma em qualquer tela.
 *   2. Jogabilidade — um bot simples precisa conseguir sobreviver.
 *   3. Rotacao — girar o aparelho no meio da partida nao pode custar o placar.
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'node_modules', '.cache', 'major-flyer-selftest');
const MODULES = [
  'src/game/constants.js',
  'src/game/stages.js',
  'src/game/layout.js',
  'src/game/World.js',
  'src/game/session.js',
  'src/services/lives.js',
];

function build() {
  for (const file of MODULES) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const out = babel.transformSync(code, {
      babelrc: false,
      configFile: false,
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    const dest = path.join(BUILD, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out.code);
  }
}

build();

const { computeLayout } = require(path.join(BUILD, 'src/game/layout.js'));
const World = require(path.join(BUILD, 'src/game/World.js')).default;
const { PHASE, SHIELD_FADE_FRAMES, STAGE_LENGTH } = require(path.join(
  BUILD,
  'src/game/constants.js'
));
const { STAGES, stageAt } = require(path.join(BUILD, 'src/game/stages.js'));
const { captureSession, restoreSession } = require(path.join(BUILD, 'src/game/session.js'));

// O modulo de vidas fala com o AsyncStorage, que so existe no celular. Como
// ele usa tres metodos, um Map faz o papel do disco — e a regra das cinco
// partidas passa a ser testavel aqui, sem emulador.
const disk = new Map();
const memoryStorage = {
  getItem: async (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: async (k, v) => {
    disk.set(k, String(v));
  },
  removeItem: async (k) => {
    disk.delete(k);
  },
};
const storagePath = require.resolve('@react-native-async-storage/async-storage', { paths: [ROOT] });
require.cache[storagePath] = {
  id: storagePath,
  filename: storagePath,
  loaded: true,
  exports: { __esModule: true, default: memoryStorage },
};
const LIVES_KEY = '@major-flyer/lives';
const {
  MAX_LIVES,
  loadLives,
  saveLives,
  initLives,
  livesNow,
  spendLife,
  refillLives,
  resetLivesState,
} = require(path.join(BUILD, 'src/services/lives.js'));

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALHOU'}  ${name}${extra ? `  (${extra})` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

/** Um passo do bot: mantem o passaro um pouco abaixo do centro do proximo vao. */
function botStep(world, L) {
  let target = L.playHeight / 2;
  let nearest = Infinity;
  for (const p of world.pillars) {
    const dx = p.x + L.pillarWidth / 2 - L.birdX;
    if (dx > -L.birdRadius && dx < nearest) {
      nearest = dx;
      target = p.gapCenter;
    }
  }
  if (world.bird.position.y > target + world.gap * 0.15 && world.bird.velocity.y >= -0.5) {
    world.flap();
  }
  world.update();
}

/**
 * Joga uma coluna em cima do passaro por um frame so, para provocar uma
 * colisao na hora certa, e em seguida devolve a coluna para fora da tela. E o
 * unico jeito de testar o escudo sem depender da sorte do bot.
 */
function forceCrash(world, L) {
  const p = world.pillars[0];
  p.x = L.birdX;
  p.scored = true; // a colisao e o assunto aqui; ponto nao entra na conta
  p.gapCenter = world.birdY - p.gap / 2 - L.birdRadius * 2;
  world._syncPillar(p);
  world.update();
  p.x = L.width + L.pillarWidth * 2;
  p.gapCenter = L.playHeight / 2;
  world._syncPillar(p);
}

/** Bot simples. Ao fechar uma fase faz o que a tela faz: avanca e recomeca. */
function autoplay(world, L, frames) {
  for (let f = 0; f < frames && world.phase !== PHASE.OVER; f++) {
    if (world.phase === PHASE.STAGE_CLEAR) {
      world.nextStage(); // a tela chama isso depois do anuncio
      world.flap(); // e o jogador toca para comecar a fase nova
    }
    botStep(world, L);
  }
}

const SCREENS = [
  ['iPhone retrato', 390, 844],
  ['iPhone paisagem', 844, 390],
  ['Android pequeno', 360, 640],
  ['Android pequeno paisagem', 640, 360],
  ['Tablet retrato', 820, 1180],
  ['Tablet paisagem', 1180, 820],
];

// --------------------------------------------------- 1. proporcao e fisica

section('Proporcao e fisica em cada formato de tela');
for (const [name, w, h] of SCREENS) {
  const L = computeLayout(w, h);
  const ratio = L.gap / (L.birdRadius * 2);
  const rise = L.flapVelocity ** 2 / (2 * L.gravity);
  const lo = L.marginY + L.gap / 2;
  const hi = L.playHeight - L.marginY - L.gap / 2;

  console.log(
    `\n [${name}] ${w}x${h} — vao ${L.gap.toFixed(0)}px, passaro ${(L.birdRadius * 2).toFixed(0)}px, ` +
      `${(L.spacing / L.speed / 60).toFixed(2)}s entre colunas`
  );
  check('razao vao/passaro constante (5.50x)', Math.abs(ratio - 5.5) < 0.01, `${ratio.toFixed(2)}x`);
  check('um toque sobe ~48% do vao', Math.abs(rise / L.gap - 0.48) < 0.01, `${((rise / L.gap) * 100).toFixed(0)}%`);
  check('faixa vertical dos vaos e usavel', hi - lo > L.gap * 0.15, `${(hi - lo).toFixed(0)}px`);

  // sem tocar em nada, a gravidade tem que derrubar o passaro
  const falling = new World(L);
  falling.flap();
  let frames = 0;
  while (falling.phase !== PHASE.OVER && frames < 3000) {
    falling.update();
    frames++;
  }
  check('sem tocar, cai e perde', falling.phase === PHASE.OVER && frames < 400, `${(frames / 60).toFixed(2)}s`);
  falling.destroy();

  // e jogavel: o bot precisa aguentar 2 minutos
  const scores = [];
  for (let i = 0; i < 4; i++) {
    const world = new World(L);
    world.flap();
    autoplay(world, L, 60 * 120);
    scores.push(world.score);
    world.destroy();
  }
  const worst = Math.min(...scores);
  check('bot sobrevive e pontua', worst >= 20, `pontos: ${scores.join(', ')}`);
}

// ------------------------------------------------------- 1b. placar na hora

section('Placar marcado no frame certo');
for (const [name, w, h] of [SCREENS[0], SCREENS[1]]) {
  const L = computeLayout(w, h);
  const world = new World(L);
  world.flap();
  let frames = 0;
  while (world.score === 0 && frames < 60 * 30) {
    botStep(world, L);
    frames++;
  }

  // A coluna que acabou de valer ponto tem que estar a menos de UM passo de
  // distancia do bico do passaro: qualquer folga maior e placar atrasado.
  const marked = world.pillars.filter((p) => p.scored);
  const edge = Math.max(...marked.map((p) => p.x + L.pillarWidth / 2));
  const nose = L.birdX + L.birdRadius;
  const slack = nose - edge;

  console.log(`\n [${name}] ${w}x${h}`);
  check('pontuou antes de 30s', world.score === 1, `${(frames / 60).toFixed(1)}s`);
  check(
    'ponto marcado no frame em que o passaro emerge da coluna',
    slack >= 0 && slack < world.speed + 1e-9,
    `sobra ${slack.toFixed(2)}px de ${world.speed.toFixed(2)}px por frame`
  );
  check(
    'nenhuma coluna passou do passaro sem pontuar',
    world.pillars.every((p) => p.scored || p.x + L.pillarWidth / 2 >= nose)
  );
  // Quanto a regra antiga (esperar a coluna passar pela CAUDA) custava:
  console.log(
    `        a regra anterior so contaria ${((2 * L.birdRadius) / world.speed / 60).toFixed(2)}s depois`
  );
  world.destroy();
}

// ------------------------------------------------------------ 2. rotacao

section('Rotacao no meio da partida');
{
  const P = computeLayout(390, 844);
  const Lx = computeLayout(844, 390);

  const fresh = new World(P);
  check('partida nova nao tem nada a retomar', captureSession(fresh).live === false);
  fresh.destroy();

  const playing = new World(P);
  playing.flap();
  autoplay(playing, P, 60 * 30);
  const scoreBefore = playing.score;
  const session = captureSession(playing);
  playing.destroy();
  check('bot pontuou antes de girar', scoreBefore > 3, `${scoreBefore} pontos`);

  const rotated = new World(Lx);
  const resumed = restoreSession(rotated, session);
  check('retomou a partida', resumed === true);
  check('placar preservado', rotated.score === scoreBefore, `${rotated.score} vs ${scoreBefore}`);
  check('volta em READY, sem cair de surpresa', rotated.phase === PHASE.READY);
  check('layout novo e o de paisagem', rotated.layout.landscape === true);
  rotated.flap();
  autoplay(rotated, Lx, 60 * 20);
  check('continua pontuando no formato novo', rotated.score > scoreBefore, `${rotated.score} pontos`);
  rotated.destroy();

  const dead = new World(P);
  dead.flap();
  for (let f = 0; f < 600 && dead.phase !== PHASE.OVER; f++) dead.update();
  const deadSession = captureSession(dead);
  dead.destroy();
  const afterDeath = new World(Lx);
  check('girar depois de perder nao ressuscita', restoreSession(afterDeath, deadSession) === false);
  check('placar zerado apos a morte', afterDeath.score === 0);
  afterDeath.destroy();

  // varias viradas seguidas
  let layout = P;
  let world = new World(layout);
  world.flap();
  autoplay(world, layout, 60 * 25);
  let carried = world.score;
  let intact = carried > 3;
  for (let i = 0; i < 6 && intact; i++) {
    const s = captureSession(world);
    world.destroy();
    layout = i % 2 === 0 ? Lx : P;
    world = new World(layout);
    restoreSession(world, s);
    if (world.score !== carried) intact = false;
    world.flap();
    autoplay(world, layout, 60 * 8);
    carried = world.score;
  }
  check('placar sobrevive a 6 viradas seguidas', intact && world.score > 3, `${world.score} pontos`);
  world.destroy();
}

// -------------------------------------------------------------- 3. fases

section('Fases, velocidade e escudo');
{
  const L = computeLayout(390, 844);

  check(
    `cada fase corre 10% mais que a anterior (${STAGES.length} fases)`,
    STAGES.every((st, i) => Math.abs(st.speed - (1 + i * 0.1)) < 1e-9),
    STAGES.map((st) => `${st.speed.toFixed(1)}x`).join(' ')
  );
  check('passar da ultima fase nao quebra', stageAt(99) === STAGES[STAGES.length - 1]);

  // Quem desenha le esta tabela sem conferir nada: um campo faltando vira tela
  // preta no celular e nao aqui. Entao confere aqui.
  const isColor = (c) => typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(c);
  const badStages = STAGES.filter((st) => {
    const p = st.pillar;
    const g = st.ground;
    return !(
      st.id &&
      st.name &&
      st.tagline &&
      st.speed > 0 &&
      st.gap > 0 &&
      Array.isArray(st.sky) &&
      st.sky.length === 5 &&
      st.sky.every(isColor) &&
      isColor(st.horizon.color) &&
      isColor(st.city) &&
      isColor(st.cityFar) &&
      Number.isFinite(st.skyline.topRadius) &&
      st.skyline.height > 0 &&
      isColor(st.star.color) &&
      st.star.density > 0 &&
      Array.isArray(p.body) &&
      p.body.length === 5 &&
      p.body.every(isColor) &&
      Array.isArray(p.cap) &&
      p.cap.length === 3 &&
      p.cap.every(isColor) &&
      p.capRatio > 0 &&
      p.capRadius >= 0 &&
      p.bodyRadius >= 0 &&
      p.shine >= 0 &&
      (p.core === null || isColor(p.core)) &&
      Array.isArray(g.gradient) &&
      g.gradient.length === 3 &&
      g.gradient.every(isColor) &&
      isColor(g.line) &&
      isColor(g.dashA) &&
      isColor(g.dashB)
    );
  });
  check(
    'toda fase tem cores e medidas completas',
    badStages.length === 0,
    badStages.length ? `falta algo em: ${badStages.map((st) => st.id).join(', ')}` : `${STAGES.length} ok`
  );
  check(
    'cada fase tem visual proprio',
    new Set(STAGES.map((st) => st.sky.join('|'))).size === STAGES.length &&
      new Set(STAGES.map((st) => st.pillar.body.join('|'))).size === STAGES.length
  );

  const world = new World(L);
  world.flap();
  let frames = 0;
  while (world.phase !== PHASE.STAGE_CLEAR && world.phase !== PHASE.OVER && frames < 60 * 120) {
    botStep(world, L);
    frames++;
  }
  check(
    `fecha a fase em ${STAGE_LENGTH} obstaculos`,
    world.phase === PHASE.STAGE_CLEAR && world.score === STAGE_LENGTH,
    `${world.score} pontos`
  );
  check('mundo congela esperando o anuncio', world.isIdle() === true);
  const frozenY = world.birdY;
  world.update();
  check('congelado mesmo: nada se move', world.birdY === frozenY);
  check('toque nao fura a fila do anuncio', world.flap() === false);

  world.nextStage();
  check('fase 2 e 10% mais rapida que a base', Math.abs(world.speed / L.speed - 1.1) < 1e-9);
  check('placar sobrevive a troca de fase', world.score === STAGE_LENGTH, `${world.score}`);
  check('volta para READY depois do anuncio', world.phase === PHASE.READY);
  check('colunas recomecam fora da tela', world.pillars.every((p) => p.x > L.width));
  check('proximo alvo e o dobro', world.stageTarget === STAGE_LENGTH * 2);
  world.destroy();

  // escudo: uma queda perdoada
  const bare = new World(L);
  bare.flap();
  let bareFrames = 0;
  while (bare.phase !== PHASE.OVER && bareFrames < 2000) {
    bare.update();
    bareFrames++;
  }
  bare.destroy();

  const shielded = new World(L);
  shielded.flap();
  shielded.grantShield();
  let shieldFrames = 0;
  while (shielded.phase !== PHASE.OVER && shieldFrames < 2000) {
    shielded.update();
    shieldFrames++;
  }
  check(
    'escudo segura a queda e depois some',
    shielded.shield === false && shieldFrames > bareFrames * 1.5,
    `${bareFrames} -> ${shieldFrames} frames`
  );
  shielded.destroy();

  // escudo se dissipando: enquanto houver anel na tela, tudo e perdoado
  const fading = new World(L);
  fading.grantShield();
  fading.flap();
  fading.update();
  check('escudo comeca inteiro', fading.shield === true && fading.shieldLevel === 1);

  forceCrash(fading, L);
  check(
    'a primeira batida nao apaga o escudo',
    fading.phase === PHASE.PLAYING && fading.shield === true && fading.shieldFading === true
  );
  check('a batida perdoada e avisada uma vez', fading.shieldHits === 1);

  const levelAfterHit = fading.shieldLevel;
  for (let i = 0; i < 20; i++) fading.update();
  check(
    'o escudo vai sumindo aos poucos, e nao de uma vez',
    fading.shield === true && fading.shieldLevel < levelAfterHit && fading.shieldLevel > 0,
    `nivel ${fading.shieldLevel.toFixed(2)}`
  );

  forceCrash(fading, L);
  check(
    'com o escudo ainda na tela, bater em outro obstaculo nao mata',
    fading.phase === PHASE.PLAYING && fading.shield === true
  );
  check('a segunda batida tambem e avisada', fading.shieldHits === 2);

  // deixa o tempo do escudo acabar, mantendo o passaro no ar
  let alive = 0;
  while (fading.shield && alive < 400) {
    if (alive % 12 === 0) fading.flap();
    fading.update();
    alive++;
  }
  check(
    `o escudo acaba sozinho em ~${(SHIELD_FADE_FRAMES / 60).toFixed(1)}s`,
    fading.shield === false && fading.shieldLevel === 0 && fading.phase === PHASE.PLAYING,
    `${alive} frames`
  );

  forceCrash(fading, L);
  check('escudo acabado: a batida seguinte encerra a partida', fading.phase === PHASE.OVER);
  fading.destroy();

  // rotacao no meio de uma fase avancada
  const Lx = computeLayout(844, 390);
  const late = new World(Lx);
  late.score = STAGE_LENGTH * 3;
  late.syncStageToScore();
  check('fase e derivada do placar', late.stage === 3, `fase ${late.stage + 1}`);
  check('alvo acompanha a fase', late.stageTarget === STAGE_LENGTH * 4);
  late.destroy();
}

// ------------------------------------------------------------- 4. reset

section('Reinicio de partida');
{
  const L = computeLayout(390, 844);
  const world = new World(L);
  world.flap();
  autoplay(world, L, 60 * 20);
  world.reset();
  check('placar zerado', world.score === 0);
  check('volta para READY', world.phase === PHASE.READY);
  check('colunas voltam para fora da tela', world.pillars.every((p) => p.x > L.width));
  check('nenhuma coluna marcada como pontuada', world.pillars.every((p) => !p.scored));
  check('volta para a fase 1', world.stage === 0 && world.shield === false);
  check('escudo zerado', world.shieldLevel === 0 && world.shieldHits === 0);
  world.destroy();
}

// --------------------------------------------------------------- 5. vidas

/**
 * As cinco partidas: o unico lugar do jogo em que o jogador pode ficar sem
 * poder jogar. Um erro de sinal aqui e ou vida infinita (e nenhum anuncio) ou
 * um jogador trancado para sempre — os dois calados.
 */
async function livesSection() {
  section('Vidas: cinco partidas e o video premiado');
  disk.clear();

  check('instalacao nova comeca com o tanque cheio', (await loadLives()) === MAX_LIVES, `${MAX_LIVES}`);

  const afterOne = await saveLives((await loadLives()) - 1);
  check(
    'comecar uma partida gasta uma vida, e ela fica gravada',
    afterOne === MAX_LIVES - 1 && (await loadLives()) === MAX_LIVES - 1,
    `${afterOne}`
  );

  let left = afterOne;
  for (let i = 0; i < 10; i++) left = await saveLives((await loadLives()) - 1);
  check('nao passa de zero por baixo', left === 0 && (await loadLives()) === 0);

  check('o video premiado devolve as cinco', (await saveLives(MAX_LIVES)) === MAX_LIVES);
  check('e nunca guarda mais que o maximo', (await saveLives(99)) === MAX_LIVES);

  disk.set(LIVES_KEY, 'isto nao e numero');
  check('valor corrompido no disco nao trava o jogador', (await loadLives()) === MAX_LIVES);
  disk.set(LIVES_KEY, '-4');
  check('valor negativo no disco vira zero', (await loadLives()) === 0);

  // --- o numero que a tela le ---
  //
  // Aqui mora o bug que ja escapou: depois do video, o jogador ganhava as cinco
  // vidas, comecava outra partida e o painel continuava marcando cinco. O
  // numero so existia depois de uma ida e volta ao disco, e no Android essa ida
  // e volta chegava tarde demais.
  section('Vidas: o numero que a tela le');
  disk.clear();
  resetLivesState();

  await initLives();
  check('abre o app com o tanque cheio', livesNow() === MAX_LIVES, `${livesNow()}`);

  check('gastar vale na hora, sem esperar disco', spendLife() === MAX_LIVES - 1);
  check('e o valor lido confere', livesNow() === MAX_LIVES - 1);

  for (let i = 0; i < 10; i++) spendLife();
  check('nao passa de zero', livesNow() === 0);

  check('o video devolve as cinco', refillLives() === MAX_LIVES);
  check(
    'e a partida logo depois do video ja debita',
    spendLife() === MAX_LIVES - 1,
    `${livesNow()} vidas`
  );

  // O disco vem atras, na fila, mas tem que terminar com o mesmo numero.
  await new Promise((r) => setTimeout(r, 30));
  check('o disco acompanha', (await loadLives()) === MAX_LIVES - 1, `${await loadLives()}`);

  // Leitura inicial lenta: gastar antes de o disco responder nao pode ser
  // desfeito pelo valor velho que chega depois.
  disk.set(LIVES_KEY, '5');
  resetLivesState();
  const slowInit = initLives();
  spendLife();
  await slowInit;
  check('disco atrasado nao devolve a vida ja gasta', livesNow() === MAX_LIVES - 1, `${livesNow()}`);
}

livesSection()
  .catch((e) => {
    failures++;
    console.log(`  FALHOU  secao de vidas quebrou  (${e.message})`);
  })
  .then(() => {
    console.log(
      failures === 0 ? '\nTodos os testes passaram.\n' : `\n${failures} teste(s) falharam.\n`
    );
    process.exit(failures === 0 ? 0 : 1);
  });

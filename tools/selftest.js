/**
 * Testes do nucleo do jogo, rodando no Node — sem emulador, sem celular.
 *
 *   npm test
 *
 * Da para testar de verdade porque a fisica e o layout vivem em modulos puros,
 * sem React: `computeLayout` so faz conta, e `World` so precisa do matter-js.
 * Os testes cobrem tres coisas que quebram calado num jogo:
 *
 *   1. Proporcao — a dificuldade tem que ser a mesma em qualquer celular, e o
 *      zoom out do retrato nao pode encolher o vao.
 *   2. Jogabilidade — um bot simples precisa conseguir sobreviver.
 *   3. Area refeita — mudar o tamanho da area de jogo no meio da partida (web,
 *      multi-janela) nao pode custar o placar.
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
  'src/game/coins.js',
  'src/game/powers.js',
  'src/game/skins.js',
  'src/game/caps.js',
  'src/game/World.js',
  'src/game/session.js',
  'src/services/season.js',
  'src/services/sha256.js',
  'src/services/integrity.js',
  'src/services/identity.js',
  'src/services/cloud.js',
  'src/services/economy.js',
  'src/services/billing.js',
  'src/ui/flightTime.js',
  'src/ui/bootProgress.js',
  'src/hooks/useFitScale.js',
  'src/i18n/index.js',
  'src/i18n/catalog.js',
  'src/i18n/locales/pt.json',
  'src/i18n/locales/en.json',
  'src/i18n/locales/es.json',
  'src/i18n/locales/it.json',
  'src/i18n/locales/de.json',
  'src/i18n/locales/fr.json',
  'src/i18n/locales/ru.json',
  'src/i18n/locales/zh.json',
  'src/i18n/locales/ja.json',
  'src/i18n/locales/ar.json',
];

function build() {
  for (const file of MODULES) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (file.endsWith('.json')) {
      // os arquivos de traducao vao como estao
      fs.mkdirSync(path.dirname(path.join(BUILD, file)), { recursive: true });
      fs.writeFileSync(path.join(BUILD, file), code);
      continue;
    }
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

// Os testes leem os textos em portugues: o idioma fica fixo nele, seja qual for
// o do computador. A secao dos idiomas troca e volta.
const i18n = require(path.join(BUILD, 'src/i18n/index.js'));
i18n.setLanguage('pt');

const { computeLayout, GAP_TO_BIRD, PORTRAIT_ZOOM } = require(path.join(BUILD, 'src/game/layout.js'));
const { formatFlightTime } = require(path.join(BUILD, 'src/ui/flightTime.js'));
const World = require(path.join(BUILD, 'src/game/World.js')).default;
const { MAGNET_MAX_REACH } = require(path.join(BUILD, 'src/game/World.js'));
const { combinePowers, powersOfRun } = require(path.join(BUILD, 'src/game/powers.js'));
const { PHASE, SHIELD_FADE_FRAMES, STAGE_LENGTH } = require(path.join(
  BUILD,
  'src/game/constants.js'
));
const { STAGES, STAGE_COUNT, stageAt, trapsAt } = require(path.join(BUILD, 'src/game/stages.js'));
const {
  DRIFT_CHANCE,
  DRIFT_MIN_STEP,
  DRIFT_SAFE_SECONDS,
  HEAVY_MULT,
  HEAVY_WARN_FRAMES,
  ICE_GAP_BITE,
  ICE_OUT_SECONDS,
  ICE_WARN_SECONDS,
} = require(path.join(BUILD, 'src/game/constants.js'));
const { captureSession, restoreSession } = require(path.join(BUILD, 'src/game/session.js'));

// A identidade do jogador fala com o AsyncStorage, que so existe no celular.
// Como ela usa tres metodos, um Map faz o papel do disco — e e esse mesmo Map
// que prova, na secao da economia, que nenhuma moeda vai parar no aparelho.
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
const season = require(path.join(BUILD, 'src/game/../services/season.js'));
const identity = require(path.join(BUILD, 'src/services/identity.js'));

// O `cloud.js` le o endereco do servidor uma vez, quando e carregado. Definir a
// variavel ANTES do require e o que permite testar o caminho ligado sem servidor
// nenhum no ar — o `fetch` daqui a pouco vira um dublê.
const FAKE_API = 'http://servidor-de-teste';
process.env.EXPO_PUBLIC_API_URL = FAKE_API;
const cloud = require(path.join(BUILD, 'src/services/cloud.js'));

const economy = require(path.join(BUILD, 'src/services/economy.js'));
const coins = require(path.join(BUILD, 'src/game/coins.js'));
const { sha256Hex } = require(path.join(BUILD, 'src/services/sha256.js'));
const integrity = require(path.join(BUILD, 'src/services/integrity.js'));
const billing = require(path.join(BUILD, 'src/services/billing.js'));

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALHOU'}  ${name}${extra ? `  (${extra})` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

/**
 * Onde o vao daquela coluna vai estar quando o passaro chegar nela.
 *
 * Conta o gelo INTEIRO, mesmo o que ainda nao saiu: e o que o jogador faz
 * depois de ver o cano piscar — ele ja se posiciona para o vao que vem.
 */
function gapOf(p) {
  const iceTop = p.ice && p.ice.side === 'top' ? p.ice.max : 0;
  const iceBottom = p.ice && p.ice.side === 'bottom' ? p.ice.max : 0;
  const top = p.gapCenter - p.gap / 2 + iceTop;
  const bottom = p.gapCenter + p.gap / 2 - iceBottom;
  return { top, bottom, center: (top + bottom) / 2, size: bottom - top };
}

/** Um passo do bot: mantem o passaro um pouco abaixo do centro do proximo vao. */
function botStep(world, L) {
  let target = L.playHeight / 2;
  let nearest = Infinity;
  for (const p of world.pillars) {
    const dx = p.x + L.pillarWidth / 2 - L.birdX;
    if (dx > -L.birdRadius && dx < nearest) {
      nearest = dx;
      target = gapOf(p).center;
    }
  }
  // Com o peso extra o passaro cai o dobro mais rapido: esperar a mesma folga
  // de sempre para bater asa seria chegar tarde.
  const slack = world.gap * (world.heavy ? 0.04 : 0.15);
  if (world.bird.position.y > target + slack && world.bird.velocity.y >= -0.5) {
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

/** Quanto um unico toque levanta o passaro, em pixels. */
function apex(world) {
  const start = world.bird.position.y;
  world.flap();
  let top = start;
  for (let i = 0; i < 180; i++) {
    world.update();
    if (world.bird.position.y < top) top = world.bird.position.y;
    if (world.bird.velocity.y >= 0) break;
  }
  return start - top;
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
  // Sem zoom (paisagem) a razao e a de sempre; no retrato o zoom out deixa o
  // passaro menor dentro do mesmo vao.
  const razao = GAP_TO_BIRD / L.zoom;
  check(
    `razao vao/passaro de ${razao.toFixed(2)}x (${L.landscape ? 'paisagem' : 'retrato, com zoom out'})`,
    Math.abs(ratio - razao) < 0.01,
    `${ratio.toFixed(2)}x`
  );
  check('um toque sobe ~48% do vao', Math.abs(rise / L.gap - 0.48) < 0.01, `${((rise / L.gap) * 100).toFixed(0)}%`);
  check('faixa vertical dos vaos e usavel', hi - lo > L.gap * 0.15, `${(hi - lo).toFixed(0)}px`);

  // Sem tocar em nada o passaro cai — e o chao NAO derruba: ele fica la ate a
  // primeira coluna chegar, e e o cano de baixo que encerra a partida.
  const falling = new World(L);
  falling.flap();
  let frames = 0;
  let tocouOChao = false;
  while (falling.phase !== PHASE.OVER && frames < 3000) {
    falling.update();
    frames++;
    if (falling.phase === PHASE.PLAYING && falling.birdY >= L.playHeight - L.birdRadius - 0.01) {
      tocouOChao = true;
    }
  }
  check(
    'sem tocar, cai no chao e so perde quando a coluna chega',
    tocouOChao && falling.phase === PHASE.OVER && frames < 400,
    `${(frames / 60).toFixed(2)}s`
  );
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

// ---------------------------------------------------- 1a. zoom do retrato

section('Zoom out do retrato');
for (const [name, w, h] of SCREENS.filter(([, sw, sh]) => sw < sh)) {
  const perto = computeLayout(w, h, { zoom: 1 }); // como era antes do zoom
  const L = computeLayout(w, h);
  const ritmo = (x) => x.spacing / x.speed / 60;
  const aFrente = (x) => (x.width - x.birdX) / x.speed / 60;

  console.log(
    `\n [${name}] ${w}x${h} — passaro ${(perto.birdRadius * 2).toFixed(0)}px -> ${(L.birdRadius * 2).toFixed(0)}px, ` +
      `coluna ${perto.pillarWidth.toFixed(0)}px -> ${L.pillarWidth.toFixed(0)}px, vao ${L.gap.toFixed(0)}px`
  );
  check(`o zoom do retrato e de ${Math.round((1 - PORTRAIT_ZOOM) * 100)}%`, L.zoom === PORTRAIT_ZOOM);
  check(
    'o vao nao encolhe: continua 31% da altura de jogo',
    L.gap === perto.gap && Math.abs(L.gap / L.playHeight - 0.31) < 1e-9,
    `${((L.gap / L.playHeight) * 100).toFixed(1)}%`
  );
  check(
    'passaro e colunas encolhem juntos',
    Math.abs(L.birdRadius / perto.birdRadius - PORTRAIT_ZOOM) < 1e-9 &&
      Math.abs(L.pillarWidth / perto.pillarWidth - PORTRAIT_ZOOM) < 1e-9
  );
  check('o ritmo entre colunas nao muda', Math.abs(ritmo(L) - ritmo(perto)) < 1e-9, `${ritmo(L).toFixed(2)}s`);
  check(
    'e cabe mais caminho na tela',
    aFrente(L) > aFrente(perto),
    `${aFrente(perto).toFixed(2)}s -> ${aFrente(L).toFixed(2)}s de caminho a vista`
  );
  check(
    'a moeda cresceu 10% em relacao ao passaro',
    Math.abs(coins.COIN_RADIUS - 0.5 * 1.1) < 1e-9,
    `${Math.round(coins.COIN_RADIUS * 100)}% do raio do passaro`
  );
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
  check('retomou a partida', resumed === 'live', String(resumed));
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
  // Perdeu, mas a partida ainda nao foi encerrada no servidor: a oferta da nova
  // chance precisa sobreviver a virada, com o placar de quando caiu.
  const restored = restoreSession(afterDeath, deadSession);
  check(
    'girar depois de perder nao ressuscita',
    restored === 'over' && afterDeath.phase === PHASE.OVER,
    String(restored)
  );
  check('a tela de fim volta com o placar da queda', afterDeath.score === deadSession.score);
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
    `cada fase corre 15% mais que a base (${STAGES.length} fases)`,
    STAGES.every((st, i) => Math.abs(st.speed - (1 + i * 0.15)) < 1e-9),
    STAGES.map((st) => `${st.speed.toFixed(2)}x`).join(' ')
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
      st.traps &&
      typeof st.traps.ice === 'boolean' &&
      typeof st.traps.heavy === 'boolean' &&
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
  // ~125 frames por obstaculo na fase 1, entao 100 deles pedem uns 3,5 minutos
  // de simulacao. Em Node isso roda em segundos.
  while (world.phase !== PHASE.STAGE_CLEAR && world.phase !== PHASE.OVER && frames < 60 * 400) {
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
  check('fase 2 e 15% mais rapida que a base', Math.abs(world.speed / L.speed - 1.15) < 1e-9);
  check('placar sobrevive a troca de fase', world.score === STAGE_LENGTH, `${world.score}`);
  check('volta para READY depois do anuncio', world.phase === PHASE.READY);
  check('colunas recomecam fora da tela', world.pillars.every((p) => p.x > L.width));
  check('proximo alvo e o dobro', world.stageTarget === STAGE_LENGTH * 2);
  world.destroy();

  // Escudo: sem tocar, o passaro fica no chao ate a coluna chegar. Sem escudo a
  // primeira coluna derruba; com escudo ela e perdoada, e so a seguinte derruba.
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
    'escudo perdoa a primeira coluna e depois some',
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

  // ------------------------------------------------------ armadilhas

  section('Armadilhas de fase');

  check(
    'fase 1 e limpa: nem gelo nem peso',
    trapsAt(0).ice === false && trapsAt(0).heavy === false
  );
  const soUma = (t) => [t.ice, t.heavy, t.drift].filter(Boolean).length === 1;
  check('fase 2 tem so o gelo', trapsAt(1).ice === true && soUma(trapsAt(1)));
  check('fase 3 tem so a gravidade', trapsAt(2).heavy === true && soUma(trapsAt(2)));
  check('fase 4 tem so o vao que se mexe', trapsAt(3).drift === true && soUma(trapsAt(3)));
  check(
    'uma mecanica nova por fase, e a ultima junta tudo',
    trapsAt(4).ice && trapsAt(4).heavy && trapsAt(4).drift,
    STAGES.map((st, i) => {
      const nomes = [st.traps.ice && 'gelo', st.traps.heavy && 'peso', st.traps.drift && 'vao']
        .filter(Boolean)
        .join('+');
      return `${i + 1}:${nomes || '-'}`;
    }).join(' ')
  );

  // --- gelo: avisa, sai e aperta o vao ---
  const iced = new World(L);
  iced.stage = 1;
  iced.applyStage(); // fase 2
  iced.flap();

  const p0 = iced.pillars[0];
  p0.ice = { side: 'top', max: iced.gap * ICE_GAP_BITE, out: 0, warn: 0 };
  const vaoLimpo = iced.bottomEdgeOf(p0) - iced.topEdgeOf(p0);

  // longe: nada acontece
  p0.x = L.birdX + iced.speed * 60 * (ICE_WARN_SECONDS + 0.5);
  iced._updateTrap(p0);
  check('longe da coluna o cano nao pisca', p0.ice.warn === 0 && p0.ice.out === 0);

  // dentro da janela do aviso: pisca, mas o gelo ainda nao saiu
  p0.x = L.birdX + iced.speed * 60 * (ICE_WARN_SECONDS - 0.2);
  iced._updateTrap(p0);
  check('o cano avisa antes de soltar o gelo', p0.ice.warn > 0 && p0.ice.out === 0);

  // dentro da janela de saida: o gelo sai e o aviso apaga
  p0.x = L.birdX + iced.speed * 60 * (ICE_OUT_SECONDS - 0.1);
  for (let i = 0; i < 40; i++) iced._updateTrap(p0);
  iced._syncPillar(p0);
  const vaoApertado = iced.bottomEdgeOf(p0) - iced.topEdgeOf(p0);
  check('o gelo sai inteiro e o aviso apaga', p0.ice.out === p0.ice.max && p0.ice.warn === 0);
  check(
    `o vao aperta ${Math.round(ICE_GAP_BITE * 100)}%`,
    Math.abs(vaoLimpo - vaoApertado - p0.ice.max) < 0.01,
    `${vaoLimpo.toFixed(0)}px -> ${vaoApertado.toFixed(0)}px`
  );
  check(
    'o gelo desce a borda de cima, e nao a de baixo',
    Math.abs(iced.topEdgeOf(p0) - (p0.gapCenter - p0.gap / 2 + p0.ice.max)) < 0.01 &&
      Math.abs(iced.bottomEdgeOf(p0) - (p0.gapCenter + p0.gap / 2)) < 0.01
  );
  iced.destroy();

  // --- o lado do gelo e sorteado ---
  const sides = new Set();
  let comArmadilha = 0;
  for (let i = 0; i < 300; i++) {
    const w = new World(L);
    w.stage = 1;
    w.applyStage();
    w._rollTrap(w.pillars[0]);
    if (w.pillars[0].ice) {
      comArmadilha++;
      sides.add(w.pillars[0].ice.side);
    }
    w.destroy();
  }
  check('o gelo sai ora de cima, ora de baixo', sides.size === 2, [...sides].join(' e '));
  check(
    'nem toda coluna tem armadilha',
    comArmadilha > 30 && comArmadilha < 270,
    `${comArmadilha} de 300`
  );

  // --- gravidade aumentada ---
  const base = new World(L);
  base.flap();
  const subidaLeve = apex(base);
  base.destroy();

  const heavy = new World(L);
  heavy.stage = 2;
  heavy.applyStage(); // fase 3
  heavy.flap();
  heavy._setHeavy(true);
  const subidaPesada = apex(heavy);
  check('a fase 3 nao solta gelo', heavy.pillars.every((p) => p.ice === null));
  check(
    `com peso (${HEAVY_MULT}x) o mesmo toque sobe menos`,
    subidaPesada < subidaLeve * 0.65,
    `${subidaLeve.toFixed(0)}px -> ${subidaPesada.toFixed(0)}px`
  );
  check('e o topo da tela pisca enquanto dura', heavy.heavyPulse > 0);

  // deixa o peso acabar sozinho
  let guard = 0;
  while (heavy.heavy && guard < 60 * 30) {
    botStep(heavy, L);
    guard++;
  }
  check('o peso passa sozinho', heavy.heavy === false && heavy.heavyPulse === 0, `${guard} frames`);
  check(
    'e a gravidade volta ao normal',
    Math.abs(heavy.engine.gravity.scale - L.gravity / (1000 / 60) ** 2) < 1e-12
  );
  heavy.destroy();

  // --- o aviso vem antes do peso ---
  const aviso = new World(L);
  aviso.stage = 2;
  aviso.applyStage();
  aviso.flap();
  const gravidadeNormal = aviso.engine.gravity.scale;
  aviso.heavyAt = aviso.frame; // a proxima rodada comeca agora

  botStep(aviso, L);
  check(
    'a seta aparece antes de a gravidade mudar',
    aviso.heavyWarn > 0 && aviso.heavy === false,
    `seta em ${aviso.heavyWarn.toFixed(2)}`
  );
  check(
    'durante o aviso a gravidade ainda e a de sempre',
    Math.abs(aviso.engine.gravity.scale - gravidadeNormal) < 1e-12
  );

  let esperou = 1;
  while (!aviso.heavy && esperou < 400) {
    botStep(aviso, L);
    esperou++;
  }
  check(
    `o aviso dura os ${(HEAVY_WARN_FRAMES / 60).toFixed(0)} s combinados`,
    Math.abs(esperou - HEAVY_WARN_FRAMES) <= 2,
    `${esperou} frames`
  );
  check(
    'quando o peso entra, a seta some e o topo pisca',
    aviso.heavyWarn === 0 && aviso.heavy === true && aviso.heavyPulse > 0
  );
  check(
    'e a gravidade dobrou de verdade',
    Math.abs(aviso.engine.gravity.scale - gravidadeNormal * HEAVY_MULT) < 1e-12
  );
  aviso.destroy();

  // --- o vao que se mexe (fase 4) ---
  //
  // A prova que faltava na primeira versao esta logo abaixo, no teste de
  // partida inteira: nao basta a coluna se mexer, ela precisa se mexer ONDE O
  // JOGADOR ESTA OLHANDO. A regra antiga contava obstaculos de antecedencia e
  // o movimento acontecia todo fora da tela.
  const vao = new World(L);
  vao.stage = 3;
  vao.applyStage(); // fase 4
  vao.flap();

  const alvo = vao.pillars[0];
  alvo.x = L.width; // acabou de entrar pela direita
  alvo.driftDone = false;
  const centroAntes = alvo.gapCenter;
  const vaoAntes = vao.bottomEdgeOf(alvo) - vao.topEdgeOf(alvo);

  let tentativas = 0;
  while (!alvo.drift && tentativas < 200) {
    alvo.driftDone = false;
    vao._updateDrift(alvo);
    tentativas++;
  }
  check('a coluna comeca a deslizar ao entrar na tela', !!alvo.drift);
  check('e acende enquanto se mexe', alvo.driftGlow > 0);

  const tamanhos = [];
  let passos = 0;
  while (alvo.drift && passos < 400) {
    vao._updateDrift(alvo);
    vao._syncPillar(alvo);
    tamanhos.push(vao.bottomEdgeOf(alvo) - vao.topEdgeOf(alvo));
    passos++;
  }
  check(
    'o vao mantem o tamanho o tempo todo',
    tamanhos.every((t) => Math.abs(t - vaoAntes) < 0.01),
    `${vaoAntes.toFixed(0)}px em ${passos} frames`
  );
  check('e o brilho apaga quando para', alvo.driftGlow === 0);

  const faixa = L.playHeight - 2 * L.marginY - vao.gap;
  const andou = Math.abs(alvo.gapCenter - centroAntes);
  check(
    'o centro anda o bastante para se notar',
    andou >= faixa * DRIFT_MIN_STEP - 0.5,
    `${andou.toFixed(0)}px de ${faixa.toFixed(0)}px de faixa`
  );
  check(
    'o vao nao sai da area de jogo',
    vao.topEdgeOf(alvo) > 0 && vao.bottomEdgeOf(alvo) < L.playHeight,
    `${vao.topEdgeOf(alvo).toFixed(0)} a ${vao.bottomEdgeOf(alvo).toFixed(0)}`
  );

  // coluna ja perto do passaro nao comeca a se mexer
  const perto = vao.pillars[1];
  perto.x = L.birdX + vao.speed * 60 * DRIFT_SAFE_SECONDS * 0.8;
  for (let i = 0; i < 300; i++) {
    perto.driftDone = false;
    vao._updateDrift(perto);
  }
  check(
    `coluna a menos de ${DRIFT_SAFE_SECONDS}s do passaro nao se mexe`,
    perto.drift === null
  );

  // e se o jogador alcancar uma que ainda desliza, ela para onde esta
  const alcancada = vao.pillars[2];
  alcancada.x = L.width;
  let t2 = 0;
  while (!alcancada.drift && t2 < 200) {
    alcancada.driftDone = false;
    vao._updateDrift(alcancada);
    t2++;
  }
  vao._updateDrift(alcancada);
  const paradoEm = alcancada.gapCenter;
  alcancada.x = L.birdX + vao.speed * 10; // o passaro chegou perto
  vao._updateDrift(alcancada);
  check(
    'coluna alcancada pelo jogador para onde esta',
    alcancada.drift === null && alcancada.gapCenter === paradoEm && alcancada.driftGlow === 0
  );
  vao.destroy();

  // --- a prova de fogo: uma partida inteira na fase 4 ---
  //
  // Roda o bot de verdade e olha, frame a frame, onde as colunas estavam quando
  // deslizaram. E o teste que teria pego o erro da primeira versao.
  const emJogo = new World(L);
  emJogo.reset();
  emJogo.score = STAGE_LENGTH * 3; // fase 4 com o placar coerente
  emJogo.stage = 3;
  emJogo.applyStage();
  emJogo.flap();

  let framesDeslizando = 0;
  let framesVisiveis = 0;
  let colunasQueMexeram = 0;
  let mexendoAntes = new Set();
  for (let f = 0; f < 60 * 60 && emJogo.phase !== PHASE.OVER; f++) {
    botStep(emJogo, L);
    const mexendoAgora = new Set();
    for (const p of emJogo.pillars) {
      if (!p.drift) continue;
      mexendoAgora.add(p);
      framesDeslizando++;
      if (p.x - L.pillarWidth / 2 < L.width) framesVisiveis++;
      if (!mexendoAntes.has(p)) colunasQueMexeram++;
    }
    mexendoAntes = mexendoAgora;
  }

  check(
    'numa partida de verdade, colunas se mexem',
    colunasQueMexeram >= 3,
    `${colunasQueMexeram} colunas em ${emJogo.stageProgress} obstaculos`
  );
  check(
    'e o jogador ve TODO o movimento acontecer',
    framesDeslizando > 0 && framesVisiveis === framesDeslizando,
    `${framesVisiveis} de ${framesDeslizando} frames dentro da tela`
  );
  emJogo.destroy();

  // frequencia: quase toda coluna se mexe
  let mexeram = 0;
  const amostras = 400;
  for (let i = 0; i < amostras; i++) {
    const w = new World(L);
    w.stage = 3;
    w.applyStage();
    const p = w.pillars[0];
    p.x = L.width;
    p.driftDone = false;
    w._updateDrift(p);
    if (p.drift) mexeram++;
    w.destroy();
  }
  const taxa = mexeram / amostras;
  check(
    `${Math.round(DRIFT_CHANCE * 100)}% das colunas se mexem, em media`,
    Math.abs(taxa - DRIFT_CHANCE) < 0.08,
    `${Math.round(taxa * 100)}% em ${amostras} sorteios`
  );

  // fase sem drift nao mexe em nada
  const parado = new World(L);
  parado.stage = 1;
  parado.applyStage(); // fase 2: gelo, sem drift
  parado.flap();
  for (const p of parado.pillars) {
    p.x = L.width;
    p.driftDone = false;
  }
  for (let i = 0; i < 200; i++) for (const p of parado.pillars) parado._updateDrift(p);
  check('fase sem a armadilha nao mexe o vao', parado.pillars.every((p) => p.drift === null));
  parado.destroy();

  // fase sem peso nunca liga a gravidade
  const clean = new World(L);
  clean.flap();
  let ligou = false;
  for (let f = 0; f < 60 * 40 && clean.phase !== PHASE.OVER; f++) {
    botStep(clean, L);
    if (clean.heavy) ligou = true;
  }
  check('fase 1 nunca fica pesada', ligou === false);
  clean.destroy();

  // --- o fim do jogo ---
  const fim = new World(L);
  fim.score = STAGE_LENGTH * STAGE_COUNT - 1; // um obstaculo antes do fim
  fim.syncStageToScore();
  check(
    'o ultimo obstaculo do jogo esta na fase 5',
    fim.stage === STAGE_COUNT - 1,
    `fase ${fim.stage + 1} de ${STAGE_COUNT}`
  );
  check(
    'e fechar essa fase pede o placar cheio',
    fim.stageTarget === STAGE_LENGTH * STAGE_COUNT,
    `${fim.stageTarget} obstaculos`
  );
  check('depois dela nao ha visual novo', fim.hasNextLook === false);
  fim.destroy();

  // quem passa do fim continua jogando, no ritmo da ultima fase
  const depois = new World(L);
  depois.score = STAGE_LENGTH * STAGE_COUNT;
  depois.syncStageToScore();
  check('passou do fim, a fase 6 existe', depois.stage === STAGE_COUNT);
  check(
    'e corre no mesmo ritmo da 5',
    Math.abs(depois.speed - L.speed * STAGES[STAGE_COUNT - 1].speed) < 1e-9
  );
  depois.destroy();

  // rotacao no meio de uma fase avancada
  const Lx = computeLayout(844, 390);
  const late = new World(Lx);
  late.score = STAGE_LENGTH * 3;
  late.syncStageToScore();
  check('fase e derivada do placar', late.stage === 3, `fase ${late.stage + 1}`);
  check('alvo acompanha a fase', late.stageTarget === STAGE_LENGTH * 4);
  late.destroy();
}

// ----------------------------------------------- 3a. so o obstaculo derruba

section('So o obstaculo derruba: chao e teto nao');
{
  const Matter = require('matter-js');
  const L = computeLayout(390, 844);
  // Tira as colunas do caminho por um bom tempo: sobram so o chao e o teto.
  const semColunas = (w) => {
    for (const p of w.pillars) {
      p.x = L.width * 20;
      w._syncPillar(p);
    }
  };

  const w = new World(L);
  w.flap();
  semColunas(w);
  for (let f = 0; f < 300; f++) w.update(); // cai e fica parado no chao
  check(
    'encostar no chao nao encerra a partida',
    w.phase === PHASE.PLAYING && w.birdY >= L.playHeight - L.birdRadius - 0.01,
    `passaro em y=${w.birdY.toFixed(0)}, chao em ${(L.playHeight - L.birdRadius).toFixed(0)}`
  );
  const vooAntes = w.flightFrames;
  for (let f = 0; f < 120; f++) w.update();
  check('e o tempo parado no chao nao conta como voo', w.flightFrames === vooAntes);

  for (let f = 0; f < 240; f++) {
    if (f % 5 === 0) w.flap();
    w.update();
  }
  check(
    'bater no teto tambem nao',
    w.phase === PHASE.PLAYING && w.bird.position.y <= L.birdRadius * 3,
    `passaro em y=${w.bird.position.y.toFixed(0)}`
  );
  w.destroy();

  // A tampa — a ponta larga do cano, virada para o vao — tambem e obstaculo.
  // `folga` e a distancia entre o passaro e a borda da tampa no passo da fisica:
  // negativa, encosta; positiva, passa rente. O corpo do cano fica sempre fora.
  const passaPelaTampa = (folga) => {
    const t = new World(L);
    t.flap();
    Matter.Body.setVelocity(t.bird, { x: 0, y: 0 });
    semColunas(t);
    const p = t.pillars[0];
    const tampa = t._capShape;
    const bordaDaTampa = L.birdX + L.birdRadius + folga;
    p.x = bordaDaTampa + tampa.width / 2 + t.speed; // o passo ainda anda `speed`
    // Passaro na altura do meio da tampa do cano de cima.
    p.gapCenter = t.bird.position.y + tampa.height / 2 + p.gap / 2;
    t._syncPillar(p);
    t.update();
    const bateu = t.phase === PHASE.OVER;
    t.destroy();
    return bateu;
  };
  check('encostar so na tampa do cano ja encerra a partida', passaPelaTampa(-3) === true);
  check('passar rente a tampa, sem encostar, nao', passaPelaTampa(3) === false);
}

// --------------------------------------------------------- 3b. tempo de voo

section('Tempo de voo');
{
  const L = computeLayout(390, 844);
  const w = new World(L);
  for (let f = 0; f < 90; f++) w.update(); // esperando o primeiro toque
  check('esperar o primeiro toque nao conta como voo', w.flightFrames === 0 && w.flightMs === 0);

  w.flap();
  for (let f = 0; f < 60 && w.phase === PHASE.PLAYING; f++) {
    if (f % 20 === 0) w.flap();
    w.update();
  }
  check('um segundo voando conta um segundo', w.flightMs === 1000, `${w.flightMs} ms`);

  // Sem tocar mais, o passaro cai; depois da queda o relogio para.
  const antesDaQueda = w.flightFrames;
  for (let f = 0; f < 600 && w.phase !== PHASE.OVER; f++) w.update();
  const naQueda = w.flightFrames;
  for (let f = 0; f < 120; f++) w.update();
  check(
    'a queda conta ate a batida, e depois o relogio para',
    w.phase === PHASE.OVER && naQueda > antesDaQueda && w.flightFrames === naQueda,
    `${naQueda - antesDaQueda} frames caindo`
  );

  check('a nova chance nao zera o voo', w.revive() === true && w.flightFrames === naQueda);
  for (let f = 0; f < 60; f++) w.update();
  check('e a espera pelo toque depois dela nao conta', w.flightFrames === naQueda);

  w.flap();
  w.update();
  const antesDoPainel = w.flightFrames;
  w.phase = PHASE.STAGE_CLEAR;
  for (let f = 0; f < 60; f++) w.update();
  check('painel de fim de fase nao conta', w.flightFrames === antesDoPainel);

  w.phase = PHASE.PLAYING;
  w.score = 3;
  const pacote = captureSession(w);
  const refeito = new World(computeLayout(412, 915));
  restoreSession(refeito, pacote);
  check(
    'o tempo de voo atravessa a area de jogo refeita',
    refeito.flightFrames === w.flightFrames,
    `${refeito.flightMs} ms`
  );
  refeito.destroy();

  w.reset();
  check('partida nova comeca do zero', w.flightFrames === 0);
  w.destroy();

  const formatos = [
    [0, '0s'],
    [45_900, '45s'],
    [12 * 60_000 + 5_000, '12min 05s'],
    [3 * 3_600_000 + 7 * 60_000 + 59_000, '3h 07min'],
    [undefined, '0s'],
  ];
  const errado = formatos.find(([ms, quer]) => formatFlightTime(ms) !== quer);
  check(
    'na Home o tempo sai curto: 45s, 12min 05s, 3h 07min',
    !errado,
    errado ? `${errado[0]} ms virou ${formatFlightTime(errado[0])}` : formatos.map(([ms]) => formatFlightTime(ms)).join(' · ')
  );
}

// ------------------------------------------------------------ 3c. poderes

/**
 * Os poderes dos passaros (powers.js), rodando no mundo de verdade. Os numeros
 * sao os do catalogo do servidor (server/catalog.go) — la e que se decide quem
 * tem qual poder e quanto ele faz; aqui se confere o que cada um faz no voo.
 */
section('Poderes dos passaros');
{
  const Matter = require('matter-js');
  const { FIXED_DT } = require(path.join(BUILD, 'src/game/constants.js'));
  const FPS = Math.round(1000 / FIXED_DT); // 1000 / (1000 / 60) nao da 60 exato
  const L = computeLayout(390, 844);
  const R = L.birdRadius;

  const IMA = { id: 'magnet', name: 'Ímã', params: { activeSeconds: 5, cooldownSeconds: 10, reach: 5 } };
  const INVISIVEL = { id: 'ghost', name: 'Invisível', params: { activeSeconds: 2, cooldownSeconds: 10 } };
  const LENTO = { id: 'slow', name: 'Câmera lenta', params: { activeSeconds: 2, cooldownSeconds: 10, percent: 20 } };

  const semColunas = (w) => {
    for (const p of w.pillars) {
      p.x = L.width * 20;
      w._syncPillar(p);
    }
  };
  const voando = (poderes) => {
    const w = new World(L);
    w.setPowers(poderes);
    w.flap();
    semColunas(w);
    return w;
  };

  // ---- o relogio: comeca recarregando, liga, recarrega de novo
  {
    const w = voando([IMA]);
    let ligou = -1;
    let desligou = -1;
    for (let f = 1; f <= 20 * FPS && desligou < 0; f++) {
      w.update();
      const ligado = w.magnetReach > 0;
      if (ligado && ligou < 0) ligou = f;
      if (!ligado && ligou > 0) desligou = f;
    }
    check('ima: recarrega 10 s antes de ligar pela primeira vez', Math.abs(ligou - 10 * FPS) <= 1, `ligou no frame ${ligou}`);
    check('...e fica ligado 5 s', Math.abs(desligou - ligou - 5 * FPS) <= 1, `${desligou - ligou} frames`);
    const [st] = w.powerStatus;
    check('o HUD recebe o poder recarregando do zero', st && st.id === 'magnet' && !st.active && st.level < 0.05);
    w.destroy();

    // Pausa, painel e anuncio nao gastam o relogio: so conta voando.
    const parado = new World(L);
    parado.setPowers([IMA]);
    for (let f = 0; f < 15 * FPS; f++) parado.update(); // esperando o primeiro toque
    check('esperando o toque, o relogio do poder nao anda', parado.powerStatus[0].level === 0);
    parado.destroy();
  }

  // ---- ima: as moedas no alcance voam ate o passaro
  {
    // O ima e do mundo: aqui ele e ligado na mao, sem esperar o relogio, e as
    // colunas ficam paradas — so o ima mexe nas moedas.
    const puxa = (alcance, ordinal = 1) => {
      const w = new World(L);
      w.setRun({ seed: 7, coinEvery: 1 }); // letra em todo obstaculo
      w.flap();
      semColunas(w);
      w.speedFactor = 0;
      const p = w.pillars.find((q) => q.ordinal === ordinal);
      // Letra na altura do passaro, com a moeda mais perto a 3,4 raios dele:
      // longe demais para encostar, perto o bastante para o ima.
      p.coin.offset = 0.5;
      p.gapCenter = w.bird.position.y;
      const perto = (x) => Math.min(...p.coin.pieces.map((q) => Math.hypot(x + q.x - L.birdX, q.y)));
      p.x = L.birdX;
      while (perto(p.x) < R * 3.4) p.x += 0.5;
      w._syncPillar(p);
      w.magnetReach = alcance;
      for (let f = 0; f < 30 && w.phase === PHASE.PLAYING; f++) {
        Matter.Body.setVelocity(w.bird, { x: 0, y: 0 }); // o passaro fica parado
        w.update();
      }
      const pegas = w.coinOrdinals.filter((o) => o === p.ordinal).length;
      const voando = w.phase === PHASE.PLAYING;
      w.destroy();
      return voando ? pegas : -1;
    };
    check('sem ima, a letra fora do alcance do passaro fica la', puxa(0) === 0);
    const comIma = puxa(R * 5);
    check('com o ima ligado, as moedas da letra voam ate o passaro e contam', comIma > 0, `${comIma} moedas`);

    // O servidor so aceita moeda ate o obstaculo seguinte ao placar: o ima nao
    // puxa a letra do obstaculo depois desse, por mais perto que ela esteja.
    check('o ima nao puxa a letra de dois obstaculos a frente', puxa(R * MAGNET_MAX_REACH, 2) === 0);
  }

  // ---- invisivel: atravessa, e nao some com o passaro dentro do cano
  {
    const w = voando([INVISIVEL]);
    const ligaEm = 10 * FPS;
    const apagaEm = ligaEm + 2 * FPS;
    for (let f = 1; f <= apagaEm - 2; f++) w.update();
    const ligado = w.ghost;

    // Faltando 2 frames para o fim, um cano engole o passaro.
    const p = w.pillars[0];
    p.x = L.birdX;
    p.gapCenter = L.playHeight / 2 - L.gap; // o passaro fica dentro do cano de baixo
    w._syncPillar(p);

    let dentroDepoisDoTempo = false;
    let apagou = -1;
    for (let f = 1; f <= 120 && w.phase === PHASE.PLAYING; f++) {
      w.update();
      if (f > 2 && w.ghost && w.overlapsObstacle()) dentroDepoisDoTempo = true;
      if (!w.ghost && apagou < 0) apagou = f;
    }
    check('invisivel: liga sozinho depois de 10 s recarregando', ligado === true);
    check('...atravessa o cano sem encerrar a partida', w.phase === PHASE.PLAYING);
    check('...e passado o tempo, espera o passaro sair do cano para desligar', dentroDepoisDoTempo && apagou > 2, `desligou ${apagou} frames depois`);

    // Desligado, o cano volta a derrubar.
    p.x = L.birdX;
    w._syncPillar(p);
    w.update();
    check('...e desligado, o cano volta a derrubar', w.phase === PHASE.OVER);
    w.destroy();

    // Invisivel atravessa sem gastar o escudo.
    const e = new World(L);
    e.flap();
    semColunas(e);
    e.grantShield();
    e.ghost = true;
    const q = e.pillars[0];
    q.x = L.birdX;
    q.gapCenter = L.playHeight / 2 - L.gap;
    e._syncPillar(q);
    e.update();
    check('invisivel atravessa sem gastar o escudo', e.phase === PHASE.PLAYING && e.shieldHits === 0 && !e.shieldFading);
    e.destroy();
  }

  // ---- mais lento: a fase atual anda 20% mais devagar
  {
    const w = voando([LENTO]);
    for (let f = 1; f <= 10 * FPS; f++) w.update(); // liga no ultimo destes
    const p = w.pillars[0];
    const antes = p.x;
    w.update();
    const passoLento = antes - p.x;
    for (let f = 0; f < 2 * FPS; f++) w.update(); // passou o tempo ligado
    const depois = p.x;
    w.update();
    const passoNormal = depois - p.x;
    check(
      'mais lento: a fase anda 20% mais devagar enquanto dura',
      Math.abs(passoLento - w.speed * 0.8) < 1e-9,
      `${passoLento.toFixed(3)} px por frame, velocidade da fase ${w.speed.toFixed(3)}`
    );
    check('...e volta a velocidade da fase depois', Math.abs(passoNormal - w.speed) < 1e-9);
    w.destroy();

    // A conta e sobre a velocidade da fase ATUAL, que ja tem o aumento dela.
    const f3 = voando([LENTO]);
    f3.stage = 2;
    f3.applyStage();
    for (let f = 1; f <= 10 * FPS; f++) f3.update();
    const q = f3.pillars[0];
    const x0 = q.x;
    f3.update();
    check('...sobre a velocidade da fase atual (fase 3 ja acelerada)', Math.abs(x0 - q.x - f3.speed * 0.8) < 1e-9 && f3.speed > L.speed);
    f3.destroy();
  }

  // ---- varios poderes no mesmo passaro
  {
    const w = voando([IMA, LENTO]);
    for (let f = 1; f <= 10 * FPS; f++) w.update();
    check('dois poderes no mesmo passaro funcionam juntos', w.magnetReach > 0 && w.speedFactor < 1);
    check('...e cada um aparece no HUD', w.powerStatus.length === 2);
    w.destroy();

    const estranho = combinePowers([{ id: 'teletransporte', name: '???' }, IMA]);
    check('poder que o app nao conhece e ignorado (servidor mais novo)', estranho.list.length === 1 && estranho.has('magnet'));
    check(
      'os poderes da partida sao os que o servidor mandou com ela',
      powersOfRun({ powers: [LENTO] })[0] === LENTO && powersOfRun(null).length === 0
    );
    const brasa = combinePowers([{ id: 'extraChance', name: 'Segunda chance', params: { extra: 1, videoOnly: 1 } }]);
    check('a chance extra diz para a tela que e so com video', brasa.param('extraChance', 'videoOnly') === 1);
  }
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

// --------------------------------------------------------------- 5. moedas

/**
 * As moedas: onde aparecem, quando sao pegas e o que vai para o servidor.
 *
 * O servidor confere cada moeda pelo NUMERO do obstaculo (server/coins.go). Se
 * o app numerar errado — contar do lugar errado depois de uma troca de fase ou
 * de uma nova chance —, moeda honesta vira moeda recusada, e o jogador nem fica
 * sabendo por que. Por isso a numeracao e testada em partida de verdade, com o
 * bot voando.
 */
function coinsSection() {
  section('Moedas: a mesma conta do servidor');

  // Os mesmos valores de server/coins_test.go.
  const referencia = {
    1: [2767685996, 1136996714, 1885302839, 1460141003, 2082786835, 3876931674],
    12345: [1868776673, 1162198605, 3936060331, 3751896808, 1195200802, 1711063604],
    2654435769: [0, 1248097530, 2307639841, 2771223418, 2311093537, 3409687398],
    4294967295: [903996321, 3101234265, 2403485737, 4133615121, 2418229727, 1440506045],
  };
  let bate = true;
  let onde = '';
  for (const [seed, rolagens] of Object.entries(referencia)) {
    rolagens.forEach((quer, i) => {
      const veio = coins.coinRoll(Number(seed), i + 1);
      if (veio !== quer && bate) {
        bate = false;
        onde = `semente ${seed}, obstaculo ${i + 1}: ${veio} em vez de ${quer}`;
      }
    });
  }
  check('a conta das moedas bate bit a bit com a do servidor', bate, onde);

  const daSemente = [];
  for (let o = 1; o <= 30; o++) if (coins.hasCoin(12345, o, 3)) daSemente.push(o);
  check(
    'as moedas da semente 12345 sao as mesmas que o servidor ve',
    JSON.stringify(daSemente) === JSON.stringify([2, 9, 10, 13, 17, 18, 19, 24, 26]),
    JSON.stringify(daSemente)
  );
  check('sem semente (treino) nao ha moeda', !coins.hasCoin(null, 2, 3) && !coins.hasCoin(undefined, 9, 3));

  // As letras: a mesma ordem, o mesmo recomeco a cada fase e o mesmo tamanho de
  // cada uma que o servidor (server/coins_test.go).
  const tamanhos = Object.fromEntries(Object.entries(coins.LETTER_PIECES).map(([l, p]) => [l, p.length]));
  check(
    'cada letra tem as mesmas moedas que o servidor conta',
    JSON.stringify(tamanhos) === JSON.stringify({ M: 13, A: 12, J: 7, O: 10, R: 12, F: 10, L: 8, Y: 7, E: 13 }),
    JSON.stringify(tamanhos)
  );
  const letras = (de, ate) => {
    const lista = [];
    for (let o = de; o <= ate; o++) {
      const l = coins.coinLetterAt(12345, o, 3, STAGE_LENGTH);
      if (l) lista.push(`${o}:${l}`);
    }
    return lista.join(' ');
  };
  check(
    'as letras seguem MAJOR FLYER, como o servidor ve',
    letras(1, 40) === '2:M 9:A 10:J 13:O 17:R 18:F 19:L 24:Y 26:E 33:R 34:M 37:A 40:J',
    letras(1, 40)
  );
  check(
    '...e cada fase recomeca do M',
    letras(101, 125) === '105:M 107:A 108:J 109:O 110:R 113:F 117:L 120:Y 122:E 124:R',
    letras(101, 125)
  );

  const L = computeLayout(390, 844);
  const RUN = { seed: 12345, coinEvery: 3 };

  section('Moedas no voo');
  {
    const treino = new World(L);
    treino.flap();
    autoplay(treino, L, 60 * 20);
    check(
      'no treino o voo inteiro passa sem moeda nenhuma',
      treino.coins === 0 && treino.pillars.every((p) => p.coin === null)
    );
    treino.destroy();
  }

  {
    const w = new World(L);
    w.setRun(RUN);
    const p = w.pillars.find((q) => q.coin);
    check(
      'com a semente do servidor, a fila ja nasce com uma letra de moedas',
      Boolean(p) && p.coin.pieces.length >= 7
    );
    if (p) {
      // A letra inteira cabe no vao sem entrar no gelo (15% do vao, de qualquer
      // lado) — em todas as fases, nas duas pontas do sorteio de altura e em
      // mais de um formato de tela.
      let pior = Infinity;
      for (const T of [L, computeLayout(360, 640), computeLayout(1280, 720)]) {
        const t = new World(T);
        t.setRun(RUN);
        const q = t.pillars.find((c) => c.coin);
        const raio = T.birdRadius * coins.COIN_RADIUS;
        for (let fase = 0; fase < STAGE_COUNT; fase++) {
          t.stage = fase;
          t.applyStage();
          for (const offset of [0, 1]) {
            q.coin.offset = offset;
            for (const peca of q.coin.pieces) {
              const y = t.pieceY(q, peca);
              pior = Math.min(
                pior,
                y - raio - (t.topEdgeOf(q) + q.gap * 0.15),
                t.bottomEdgeOf(q) - q.gap * 0.15 - (y + raio)
              );
            }
          }
        }
        t.destroy();
      }
      check('a letra inteira cabe no vao sem entrar no gelo, em qualquer fase', pior > -0.001, `folga minima ${Math.max(0, pior).toFixed(1)} px`);

      // Encostar numa moeda da letra pega ela — e as vizinhas que o corpo do
      // passaro cobre. O passaro ja esta chegando a esse obstaculo: letra de
      // obstaculo alem do seguinte ao placar nao se pega (o servidor recusaria).
      w.score = p.ordinal - 1;
      const peca = p.coin.pieces[0];
      p.x = L.birdX - peca.x;
      w.bird.position.y = w.pieceY(p, peca);
      w._collectCoins();
      const pegas = p.coin.pieces.filter((q) => q.taken).length;
      check(
        'encostar numa moeda da letra pega a moeda',
        peca.taken && w.coins === pegas && pegas >= 1 && pegas < p.coin.pieces.length,
        `${pegas} de ${p.coin.pieces.length}`
      );
      check(
        'e guarda o numero do obstaculo uma vez por moeda, que e o que vai para o servidor',
        w.coinOrdinals.length === pegas && w.coinOrdinals.every((o) => o === p.ordinal)
      );
      w._collectCoins();
      check('a mesma moeda nao conta duas vezes', w.coins === pegas && w.coinOrdinals.length === pegas);
    }
    w.destroy();
  }

  {
    // Partida de verdade: o bot voa por um minuto, atravessando troca de fase.
    const w = new World(L);
    w.setRun(RUN);
    w.flap();
    let colunas = 0;
    let errada = '';
    for (let f = 0; f < 60 * 60 && w.phase !== PHASE.OVER; f++) {
      if (w.phase === PHASE.STAGE_CLEAR) {
        w.nextStage();
        w.flap();
      }
      const jaPassadas = new Set(w.pillars.filter((q) => q.scored));
      const placar = w.score;
      botStep(w, L);
      if (w.score === placar) continue;
      for (const q of w.pillars) {
        if (!q.scored || jaPassadas.has(q)) continue;
        colunas++;
        if (q.ordinal !== w.score && !errada) errada = `coluna ${q.ordinal} passada com placar ${w.score}`;
      }
    }
    check(
      'cada coluna e passada com o placar igual ao numero dela',
      !errada && colunas > 10,
      errada || `${colunas} colunas`
    );
    check(
      'toda moeda pega e de obstaculo que tinha moeda',
      w.coinOrdinals.every((o) => coins.hasCoin(RUN.seed, o, RUN.coinEvery))
    );
    const porObstaculo = new Map();
    for (const o of w.coinOrdinals) porObstaculo.set(o, (porObstaculo.get(o) || 0) + 1);
    check(
      'nenhum obstaculo com mais moedas do que a letra dele tem',
      [...porObstaculo].every(
        ([o, n]) => n <= coins.LETTER_PIECES[coins.coinLetterAt(RUN.seed, o, RUN.coinEvery, STAGE_LENGTH)].length
      )
    );
    check(
      'nenhuma moeda da letra contada duas vezes',
      new Set(w.coinPieces.map(([o, i]) => `${o}:${i}`)).size === w.coinPieces.length
    );
    check(
      'voando pelas letras, o passaro pega mais de uma moeda de cada',
      w.coins > porObstaculo.size,
      `${w.coins} moedas em ${porObstaculo.size} letras`
    );
    check('nenhuma alem de onde o passaro chegou', w.coinOrdinals.every((o) => o <= w.score + 1));
    check('o contador bate com a lista', w.coins === w.coinOrdinals.length, `${w.coins} moedas`);
    w.destroy();
  }

  {
    const w = new World(L);
    w.setRun(RUN);
    w.score = STAGE_LENGTH;
    w.phase = PHASE.STAGE_CLEAR;
    w.nextStage();
    const ordinais = w.pillars.map((q) => q.ordinal).sort((x, y) => x - y);
    check(
      'fase nova: a fila continua numerada a partir do placar',
      ordinais[0] === STAGE_LENGTH + 1,
      JSON.stringify(ordinais)
    );
    w.destroy();
  }

  section('Nova chance');
  {
    const w = new World(L);
    w.setRun(RUN);
    w.flap();
    for (let f = 0; f < 10; f++) w.update();
    // Como se ja tivesse passado oito obstaculos: a fila vem numerada do 9.
    w.score = 8;
    w._layPillars();

    // Uma moeda pega a mao numa coluna que ainda estava por vir, para o teste
    // nao depender da mira do bot. Guarda-se o NUMERO: depois da nova chance a
    // mesma coluna e renumerada, e o que importa e o obstaculo, nao o objeto.
    const alvo = w.pillars.find((q) => q.coin && q.ordinal <= w.score + 1);
    const numeroDoAlvo = alvo ? alvo.ordinal : null;
    let pegasDoAlvo = [];
    if (alvo) {
      const peca = alvo.coin.pieces[0];
      alvo.x = L.birdX - peca.x;
      w.bird.position.y = w.pieceY(alvo, peca);
      w._collectCoins();
      pegasDoAlvo = alvo.coin.pieces.filter((q) => q.taken).map((q) => q.i);
    }
    const placar = w.score;
    const moedas = w.coinOrdinals.slice();

    check('fora da queda nao ha nova chance', w.revive() === false);
    w.birdY = w.bird.position.y; // a batida forcada mira onde o passaro esta de fato
    forceCrash(w, L);
    check('a batida sem escudo derruba', w.phase === PHASE.OVER);
    check('com o passaro caido, a nova chance vale', w.revive() === true);
    check('volta em READY, esperando o toque', w.phase === PHASE.READY);
    check(
      'placar e moedas ficam',
      w.score === placar && JSON.stringify(w.coinOrdinals) === JSON.stringify(moedas),
      `${w.score} pontos, ${w.coins} moedas`
    );
    check('as colunas recomecam fora da tela', w.pillars.every((q) => q.x > L.width));
    check(
      'numeradas a partir do placar',
      Math.min(...w.pillars.map((q) => q.ordinal)) === w.score + 1
    );
    check('a nova chance fica contada', w.continuesUsed === 1);
    if (numeroDoAlvo !== null) {
      const mesma = w.pillars.find((q) => q.ordinal === numeroDoAlvo);
      const pegas = mesma && mesma.coin ? mesma.coin.pieces.filter((q) => q.taken).map((q) => q.i) : [];
      check(
        'moeda pega antes da queda nao reaparece, e o resto da letra continua la',
        pegasDoAlvo.length > 0 &&
          JSON.stringify(pegas) === JSON.stringify(pegasDoAlvo) &&
          pegas.length < mesma.coin.pieces.length,
        mesma ? `obstaculo ${numeroDoAlvo}: ${pegas.length} moedas pegas` : 'a coluna nao voltou para a fila'
      );
    }
    check('e nao ha segunda nova chance sem cair de novo', w.revive() === false);
    w.destroy();
  }

  section('Moedas e escudo atravessam a virada de tela');
  {
    const P = computeLayout(390, 844);
    const Lx = computeLayout(844, 390);
    const w = new World(P);
    w.setRun(RUN);
    w.flap();
    for (let f = 0; f < 10; f++) w.update();
    w.score = 5;
    const alvo = w.pillars.find((q) => q.coin && q.ordinal <= w.score + 1);
    if (alvo) {
      const peca = alvo.coin.pieces[0];
      alvo.x = P.birdX - peca.x;
      w.bird.position.y = w.pieceY(alvo, peca);
      w._collectCoins();
    }
    w.grantShield();
    const pacote = captureSession(w);
    w.destroy();

    const girado = new World(Lx);
    girado.setRun(RUN);
    const como = restoreSession(girado, pacote);
    check('a partida volta', como === 'live', String(como));
    check(
      'com as mesmas moedas',
      pacote.coins > 0 &&
        girado.coins === pacote.coins &&
        JSON.stringify(girado.coinOrdinals) === JSON.stringify(pacote.coinOrdinals) &&
        JSON.stringify(girado.coinPieces) === JSON.stringify(pacote.coinPieces),
      `${girado.coins}`
    );
    check('com o escudo que ja estava pago', girado.shield === true);
    check(
      'e a fila numerada a partir do placar',
      Math.min(...girado.pillars.map((q) => q.ordinal)) === girado.score + 1
    );
    girado.destroy();
  }
}

// -------------------------------------------------------- 6. rodadas semanais

/**
 * As rodadas abrem domingo 20h e fecham domingo 18h. E conta de calendario com
 * fuso fixo: o tipo de coisa que funciona o ano inteiro e quebra numa virada de
 * mes, entao aqui a semana e varrida hora a hora.
 */
function seasonSection() {
  section('Rodadas semanais');

  const em = (iso) => season.seasonAt(new Date(iso));

  // 2026-09-06 e um domingo. 20h em Brasilia (-3) = 23h UTC.
  check('abre domingo as 20h', em('2026-09-06T23:00:00Z').id === '2026-09-06', em('2026-09-06T23:00:00Z').id);
  check(
    'um minuto antes ainda e a rodada anterior',
    em('2026-09-06T22:59:00Z').id === '2026-08-30',
    em('2026-09-06T22:59:00Z').id
  );
  check('no meio da semana continua a mesma', em('2026-09-09T15:00:00Z').id === '2026-09-06');
  check(
    'domingo 17h59 ainda vale ponto',
    em('2026-09-13T20:59:00Z').state === 'running' && em('2026-09-13T20:59:00Z').id === '2026-09-06'
  );
  check(
    'domingo 18h01 ja e apuracao',
    em('2026-09-13T21:01:00Z').state === 'counting' && em('2026-09-13T21:01:00Z').id === '2026-09-06'
  );
  check('domingo 20h01 comeca a rodada nova', em('2026-09-13T23:01:00Z').id === '2026-09-13');

  const uma = em('2026-09-09T15:00:00Z');
  check(
    'a rodada anterior e a seguinte, para navegar no ranking',
    season.previousSeason(uma).id === '2026-08-30' && season.nextSeason(uma).id === '2026-09-13'
  );
  const dias = (uma.nextOpensAt - uma.startsAt) / 86400000;
  check('cada rodada dura uma semana cheia', Math.abs(dias - 7) < 1e-9, `${dias} dias`);
  const janela = (uma.nextOpensAt - uma.endsAt) / 3600000;
  check('sobram 2h de apuracao no fim', Math.abs(janela - 2) < 1e-9, `${janela}h`);

  // Varredura: oito semanas, de hora em hora. Nenhum buraco, nenhuma sobra.
  let buracos = 0;
  let saltos = 0;
  let anterior = null;
  for (let h = 0; h < 24 * 7 * 8; h++) {
    const quando = new Date(Date.UTC(2026, 8, 1, 0, 0, 0) + h * 3600000);
    const s = season.seasonAt(quando);
    const dentro = quando >= s.startsAt && quando < s.nextOpensAt;
    if (!dentro) buracos++;
    if (anterior && s.id !== anterior.id) {
      const passo = (s.startsAt - anterior.startsAt) / 86400000;
      if (Math.abs(passo - 7) > 1e-9) saltos++;
    }
    anterior = s;
  }
  check('todo instante cai dentro de uma rodada', buracos === 0, `${buracos} fora`);
  check('e uma rodada comeca 7 dias depois da outra', saltos === 0, `${saltos} saltos`);

  check('o rotulo sai legivel', season.seasonLabel(uma) === '6 a 13 de setembro', season.seasonLabel(uma));
  check('o tempo que falta sai curto', season.formatRemaining(3 * 3600000 + 25 * 60000) === '3h 25min');
}

// --------------------------------------------------------- 7. identidade

function identitySection() {
  section('Codigo do jogador');

  const uuid = identity.newUuid();
  check(
    'o codigo tem cara de UUID v4',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid),
    uuid
  );
  const muitos = new Set(Array.from({ length: 500 }, () => identity.newUuid()));
  check('e nao repete', muitos.size === 500, `${muitos.size} de 500`);

  check('nome ganha um corte de espacos', identity.sanitizeName('  Andre  ') === 'Andre');
  check('nome colapsa espacos do meio', identity.sanitizeName('Voo   Livre') === 'Voo Livre');
  check('nome curto demais e recusado', identity.sanitizeName('a') === null);
  check('nome so de espacos e recusado', identity.sanitizeName('    ') === null);
  check(
    `nome longo e cortado em ${identity.NAME_MAX}`,
    identity.sanitizeName('a'.repeat(60)).length === identity.NAME_MAX
  );
}

// ------------------------------------------- 8. a economia, pelo lado do app

/**
 * Moedas, vidas, loja e partidas, vistas pelo app (economy.js).
 *
 * O servidor tem os testes dele, contra um Postgres de verdade. Aqui se confere
 * o outro lado do combinado: o app so MOSTRA o que o servidor devolve (nunca
 * soma saldo por conta propria), nao grava nada de economia no aparelho, espera
 * a confirmacao do anuncio e nao perde a partida fechada sem rede. Um `fetch` de
 * mentira faz o papel do servidor.
 */
async function economySection() {
  section('Economia: o servidor manda, o aparelho so mostra');

  const pedidos = [];
  let responder = () => ({ status: 200, body: {} });
  const fetchOriginal = global.fetch;
  global.fetch = async (url, options = {}) => {
    const pedido = {
      path: String(url).replace(FAKE_API, ''),
      method: options.method,
      headers: options.headers || {},
      corpo: options.body ? JSON.parse(options.body) : null,
    };
    pedidos.push(pedido);
    const r = responder(pedido);
    if (r.falha) throw Object.assign(new Error('sem rede'), { name: r.falha });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };

  const carteira = (extra = {}) => ({
    coins: 120,
    lives: 4,
    maxLives: 5,
    shields: 1,
    continues: 0,
    equippedBird: 'classic',
    ownedBirds: ['classic'],
    ...extra,
  });
  const catalogo = {
    birds: [
      { id: 'classic', name: 'Major', price: 0, powers: [] },
      {
        id: 'frost',
        name: 'Geada',
        price: 150,
        powers: [{ id: 'slow', name: 'Câmera lenta', params: { activeSeconds: 2, cooldownSeconds: 10, percent: 20 } }],
      },
    ],
    items: { shield: { price: 60 }, continue: { price: 100 } },
    rules: { maxLives: 5, coinEvery: 3, stageLength: 100, stageBonus: 10 },
  };
  const naoAchou = { status: 404, body: {} };

  try {
    identity.resetPlayerState();
    economy.resetEconomyState();
    disk.clear();
    const jogador = await identity.initPlayer();
    const chavesDoJogador = new Set(disk.keys());

    // ---- abrir o app
    responder = (p) => {
      if (p.path === '/v1/catalog') return { status: 200, body: catalogo };
      if (p.path === '/v1/me/wallet') return { status: 200, body: { wallet: carteira() } };
      return naoAchou;
    };
    await economy.refresh();
    check(
      'ao abrir, a carteira vem do servidor',
      economy.economyNow().status === 'ready' && economy.economyNow().wallet.coins === 120
    );
    check(
      'e os precos tambem',
      economy.priceOf('continue') === 100 && economy.birdById('frost').price === 150
    );

    // ---- abrir partida
    pedidos.length = 0;
    responder = (p) =>
      p.path === '/v1/runs/start'
        ? {
            status: 200,
            body: {
              run: { id: 'r1', seed: 12345, coinEvery: 3, maxContinues: 1 },
              wallet: carteira({ lives: 3 }),
            },
          }
        : naoAchou;
    const aberta = await economy.startRun();
    check('a partida so comeca com a semente vinda do servidor', aberta.ok && aberta.run.seed === 12345);
    check('quem desconta a vida e o servidor', economy.economyNow().wallet.lives === 3);
    check(
      'o pedido vai identificado',
      pedidos[0]?.headers['X-Player-Id'] === jogador.id &&
        pedidos[0]?.headers['X-Player-Secret'] === jogador.secret
    );

    // ---- fechar partida
    pedidos.length = 0;
    responder = (p) =>
      p.path === '/v1/runs/r1/finish'
        ? {
            status: 200,
            body: {
              result: { points: 42, coins: 2, stageBonus: 0 },
              wallet: carteira({ coins: 500, lives: 3 }),
            },
          }
        : naoAchou;
    const fechada = await economy.finishRun('r1', {
      points: 42,
      coinOrdinals: [2, 9, 10],
      flightMs: 61234.4,
    });
    check(
      'fechar manda o placar, os numeros dos obstaculos das moedas e o tempo de voo',
      JSON.stringify(pedidos[0]?.corpo) ===
        JSON.stringify({ points: 42, coinOrdinals: [2, 9, 10], flightMs: 61234 }),
      JSON.stringify(pedidos[0]?.corpo)
    );
    check('o que vale e o que o servidor creditou', fechada.ok && fechada.result.coins === 2);
    check(
      'o saldo na tela e o do servidor, sem conta feita no aparelho',
      economy.economyNow().wallet.coins === 500,
      `${economy.economyNow().wallet.coins}`
    );

    // ---- recusa
    responder = () => ({ status: 409, body: { error: 'moedas insuficientes', code: 'not_enough_coins' } });
    const recusa = await economy.buy('bird', 'frost');
    check(
      'a recusa chega com o motivo e o codigo',
      !recusa.ok && recusa.code === 'not_enough_coins' && recusa.error === 'moedas insuficientes'
    );
    check('e a carteira nao muda', economy.economyNow().wallet.coins === 500);

    // ---- evoluir o passaro (estrelas)
    pedidos.length = 0;
    responder = (p) =>
      p.path === '/v1/shop/upgrade'
        ? { status: 200, body: { wallet: carteira({ coins: 490, birdLevels: { frost: 1 } }) } }
        : naoAchou;
    const estrela = await economy.upgradeBird('frost');
    check(
      'a estrela do passaro e comprada no servidor, e a carteira volta com ela',
      estrela.ok &&
        pedidos[0]?.path === '/v1/shop/upgrade' &&
        JSON.stringify(pedidos[0]?.corpo) === JSON.stringify({ birdId: 'frost' }) &&
        economy.economyNow().wallet.birdLevels.frost === 1,
      JSON.stringify(pedidos[0]?.corpo)
    );

    // ---- skins: comprar, vestir e tirar
    pedidos.length = 0;
    responder = (p) =>
      p.path === '/v1/shop/buy' || p.path === '/v1/me/skin'
        ? { status: 200, body: { wallet: carteira({ coins: 480, ownedSkins: ['cap_red'], equippedSkins: {} }) } }
        : naoAchou;
    await economy.buy('skin', 'cap_red');
    await economy.equipSkin('cap_red');
    await economy.unequipSkin('cap');
    check(
      'skin: compra, veste e tira pelo servidor, com o id da skin ou o encaixe',
      JSON.stringify(pedidos.map((p) => [p.path, p.corpo])) ===
        JSON.stringify([
          ['/v1/shop/buy', { item: 'skin', skinId: 'cap_red' }],
          ['/v1/me/skin', { skinId: 'cap_red' }],
          ['/v1/me/skin', { slot: 'cap' }],
        ]),
      JSON.stringify(pedidos.map((p) => p.corpo))
    );
    check('...e a carteira volta com a colecao', economy.economyNow().wallet.ownedSkins.includes('cap_red'));

    // ---- anuncio
    let tentativas = 0;
    responder = (p) => {
      if (p.path !== '/v1/ads/claim') return naoAchou;
      tentativas++;
      return tentativas < 3
        ? { status: 202, body: { pending: true } }
        : { status: 200, body: { wallet: carteira({ coins: 500, lives: 5 }), kind: 'lives' } };
    };
    const premio = await economy.claimAd('lives', { delays: [0, 0, 0], wait: async () => {} });
    check(
      'o premio espera a confirmacao do Google chegar ao servidor',
      premio.ok && tentativas === 3,
      `${tentativas} tentativas`
    );
    check('e so aparece quando o servidor registra', economy.economyNow().wallet.lives === 5);

    responder = () => ({ status: 202, body: { pending: true } });
    const semConfirmacao = await economy.claimAd('shield', { delays: [0, 0], wait: async () => {} });
    check('sem confirmacao, nao ha premio', !semConfirmacao.ok && semConfirmacao.pending === true);
    check(
      'e o jogador le um texto sem bastidor (nada de Google ou servidor)',
      semConfirmacao.error === economy.CLAIM_MESSAGES.production &&
        !/google|servidor/i.test(semConfirmacao.error)
    );

    // Anuncio de teste (desenvolvimento) nunca gera o aviso do Google: esperar
    // 25 s nao muda nada, entao uma tentativa so, com o texto que explica o que
    // fazer para testar premios.
    let pedidosDeTeste = 0;
    responder = (p) => {
      if (p.path === '/v1/ads/claim') pedidosDeTeste++;
      return { status: 202, body: { pending: true } };
    };
    const deTeste = await economy.claimAd('lives', {
      testAd: true,
      delays: [0, 0, 0],
      wait: async () => {},
    });
    check(
      'anuncio de teste: uma tentativa so, sem esperar a confirmacao que nao vem',
      !deTeste.ok && pedidosDeTeste === 1,
      `${pedidosDeTeste} tentativas`
    );
    check('...e o texto diz como testar premios', deTeste.error === economy.CLAIM_MESSAGES.testAd);

    // ---- a resposta do fechamento se perde no caminho
    // Conexao parada morre em silencio no caminho ate a VPS, e o pedido fica sem
    // resposta ate o prazo. Fechar pode repetir (o servidor devolve o mesmo
    // resultado), entao o app tenta de novo e fica com as moedas.
    let fechamentos = 0;
    responder = (p) => {
      if (p.path !== '/v1/runs/r1/finish') return naoAchou;
      fechamentos++;
      return fechamentos === 1
        ? { falha: 'AbortError' }
        : {
            status: 200,
            body: {
              result: { points: 42, coins: 2, stageBonus: 0 },
              wallet: carteira({ coins: 500, lives: 3 }),
            },
          };
    };
    const repetido = await economy.finishRun('r1', { points: 42, coinOrdinals: [2, 9, 10] });
    check(
      'fechamento sem resposta tenta de novo e fica com o resultado',
      repetido.ok && repetido.result.coins === 2 && fechamentos === 2,
      `${fechamentos} tentativas`
    );
    check('...sem a tela cair para o modo treino', economy.economyNow().status === 'ready');

    // O que gasta vida, moeda ou video NAO repete sozinho: a primeira tentativa
    // pode ter chegado e so a resposta ter se perdido.
    const gastam = [
      ['abrir partida', '/v1/runs/start', () => economy.startRun()],
      ['comprar', '/v1/shop/buy', () => economy.buy('shield')],
      [
        'trocar video por premio',
        '/v1/ads/claim',
        () => economy.claimAd('lives', { delays: [], wait: async () => {} }),
      ],
    ];
    for (const [nome, caminho, chamar] of gastam) {
      let vezes = 0;
      responder = (p) => {
        if (p.path === caminho) vezes++;
        return { falha: 'AbortError' };
      };
      const r = await chamar();
      check(
        `${nome} sem resposta nao se repete sozinho`,
        !r.ok && r.offline === true && vezes === 1,
        `${vezes} tentativas`
      );
    }

    // ---- sem rede
    responder = () => ({ falha: 'TypeError' });
    const semRede = await economy.finishRun('r2', { points: 12, coinOrdinals: [9] });
    check('sem rede, o fechamento falha como offline', !semRede.ok && semRede.offline === true);
    check('e a tela passa a oferecer so o treino', economy.economyNow().status === 'offline');

    pedidos.length = 0;
    responder = (p) => {
      if (p.path === '/v1/runs/r2/finish') {
        return { status: 200, body: { result: { coins: 1, stageBonus: 0 }, wallet: carteira({ coins: 501 }) } };
      }
      if (p.path === '/v1/runs/start') {
        return {
          status: 200,
          body: {
            run: { id: 'r3', seed: 7, coinEvery: 3, maxContinues: 1 },
            wallet: carteira({ coins: 501, lives: 2 }),
          },
        };
      }
      return naoAchou;
    };
    await economy.startRun();
    const ordem = pedidos.map((p) => p.path);
    check(
      'a partida fechada sem rede sobe antes de abrir a proxima',
      ordem[0] === '/v1/runs/r2/finish' && ordem.includes('/v1/runs/start'),
      JSON.stringify(ordem)
    );

    // ---- disco
    const novas = [...disk.keys()].filter((k) => !chavesDoJogador.has(k));
    check('nada de moeda, vida ou item gravado no aparelho', novas.length === 0, JSON.stringify(novas));
  } finally {
    global.fetch = fetchOriginal;
    economy.resetEconomyState();
    identity.resetPlayerState();
  }
}

// ------------------------------------------------ 9. a conversa com o servidor

/**
 * O transporte e as rotas de grupo e ranking (cloud.js): os cabecalhos que vao,
 * a apresentacao automatica a um servidor que nao conhece o aparelho, e as
 * respostas estranhas que nao podem derrubar o jogo.
 */
async function cloudSection() {
  section('Ranking online: o combinado com o servidor');

  const pedidos = [];
  let respostas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, options = {}) => {
    pedidos.push({ url, ...options });
    const r = respostas.shift() || { status: 200, body: {} };
    if (r.falha) throw Object.assign(new Error('sem rede'), { name: r.falha });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (r.texto !== undefined ? r.texto : JSON.stringify(r.body ?? {})),
    };
  };

  try {
    check('com endereco configurado, o online liga', cloud.isConfigured() === true);

    identity.resetPlayerState();
    disk.clear();
    const jogador = await identity.initPlayer();

    // ---- servidor novo (ou banco restaurado): se apresenta e insiste
    pedidos.length = 0;
    respostas = [
      { status: 401, body: { error: 'jogador desconhecido neste servidor' } },
      { status: 200, body: { player: { id: jogador.id, name: jogador.name } } },
      { status: 200, body: { group: null } },
    ];
    const grupo = await cloud.myGroup();
    check('servidor que nao conhece o aparelho: ele se apresenta e insiste', grupo.ok === true);
    check(
      '...e a apresentacao foi em /v1/players',
      pedidos[1]?.url === `${FAKE_API}/v1/players`,
      pedidos[1]?.url
    );

    // ---- ranking publico
    pedidos.length = 0;
    respostas = [{ status: 200, body: { rows: [] } }];
    await cloud.topPlayers(20);
    check('o ranking sai sem cabecalho de jogador', pedidos[0]?.headers?.['X-Player-Id'] === undefined);
    check(
      '...e pede o tamanho que a tela quer',
      pedidos[0]?.url === `${FAKE_API}/v1/rankings/players?limit=20`,
      pedidos[0]?.url
    );
    check(
      'cada pedido pede conexao nova (conexao parada morre em silencio no caminho)',
      pedidos[0]?.headers?.Connection === 'close',
      pedidos[0]?.headers?.Connection
    );

    // ---- respostas estranhas
    pedidos.length = 0;
    respostas = [{ status: 502, texto: '<html>Bad Gateway</html>' }];
    const proxy = await cloud.topGroups(10);
    check(
      'pagina de erro do proxy nao derruba o app e conta como sem conexao',
      !proxy.ok && proxy.offline === true
    );
    check('...e nao insiste: o proxy respondeu', pedidos.length === 1, `${pedidos.length} pedidos`);

    pedidos.length = 0;
    respostas = [{ falha: 'AbortError' }, { falha: 'AbortError' }];
    const lento = await cloud.topGroups(10);
    check('servidor que demora demais tambem', !lento.ok && lento.offline === true);
    check('...depois de uma segunda tentativa', pedidos.length === 2, `${pedidos.length} pedidos`);

    pedidos.length = 0;
    respostas = [{ falha: 'TypeError' }, { status: 200, body: { rows: [] } }];
    const salvo = await cloud.topGroups(10);
    check(
      'consulta que perdeu a conexao no caminho: a segunda tentativa resolve',
      salvo.ok === true && pedidos.length === 2,
      `${pedidos.length} pedidos`
    );
  } finally {
    global.fetch = fetchOriginal;
    identity.resetPlayerState();
  }
}

// -------------------------------------- 10. a prova de integridade da partida

/**
 * A prova de que a partida foi jogada no app de verdade (integrity.js).
 *
 * O token vem do Google Play, entao aqui um dublê faz o papel dele. O que se
 * confere e o combinado com o servidor: o resumo do fechamento e o MESMO dos
 * dois lados (os valores de referencia sao os de server/integrity_test.go), so
 * partida que rendeu alguma coisa gasta uma prova, e nada disso pode impedir a
 * partida de subir.
 */
async function integritySection() {
  section('Prova de integridade da partida');

  const { createHash } = require('crypto');
  const noNode = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
  const textos = ['', 'finish|r1|0|0|', 'voo com acento: coracao é ç 🕊', 'a'.repeat(200)];
  check(
    'o SHA-256 do app e o mesmo do Node (e, com ele, o do Go)',
    textos.every((t) => sha256Hex(t) === noNode(t))
  );

  const partida = '2f6f1c7e-3b1a-4c5d-9e8f-0a1b2c3d4e5f';
  check(
    'o resumo do fechamento bate com o do servidor',
    integrity.finishHash(partida, { points: 42, coinOrdinals: [2, 9, 10], flightMs: 61234 }) ===
      '1cb58bfc45863d18bd6314559005ab077670808bcd630abdabb27c04894efbf2'
  );
  check(
    '...inclusive quando nao houve moeda nenhuma',
    integrity.finishHash(partida, { points: 7, coinOrdinals: [], flightMs: 12000 }) ===
      'c4d27f8e067a95fa5bd43b1c965ee67f0343a791efaf4cbb3329924e9101490d'
  );

  const pedidos = [];
  let responder = () => ({ status: 200, body: {} });
  const fetchOriginal = global.fetch;
  global.fetch = async (url, options = {}) => {
    const pedido = {
      path: String(url).replace(FAKE_API, ''),
      headers: options.headers || {},
      corpo: options.body ? JSON.parse(options.body) : null,
    };
    pedidos.push(pedido);
    const r = responder(pedido);
    if (r.falha) throw Object.assign(new Error('sem rede'), { name: r.falha });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };

  const carteira = {
    coins: 0,
    lives: 5,
    maxLives: 5,
    shields: 0,
    continues: 0,
    flightMs: 0,
    equippedBird: 'classic',
    ownedBirds: ['classic'],
  };
  const fechou = {
    status: 200,
    body: { result: { points: 0, coins: 0, stageBonus: 0 }, wallet: carteira },
  };

  // O dublê do Google: conta as preparacoes e as provas, e devolve um token que
  // diz de qual resumo ele saiu.
  let preparacoes = 0;
  let provas = 0;
  let vencer = 0; // quantas vezes o provedor vai dizer que venceu
  const google = {
    prepareIntegrityTokenProviderAsync: async () => {
      preparacoes++;
    },
    requestIntegrityCheckAsync: async (hash) => {
      if (vencer > 0) {
        vencer--;
        throw new Error('provedor vencido');
      }
      provas++;
      return `prova(${hash})`;
    },
  };
  const provaDe = (p) => p && p.headers['X-Integrity-Token'];

  try {
    identity.resetPlayerState();
    economy.resetEconomyState();
    disk.clear();
    await identity.initPlayer();
    integrity.__setProvider(google);
    responder = () => fechou;

    // ---- partida que rendeu sobe com a prova
    pedidos.length = 0;
    const jogada = { points: 30, coinOrdinals: [3, 6], flightMs: 20000 };
    await economy.finishRun('r1', jogada);
    check(
      'partida que rendeu sobe com a prova deste placar',
      provaDe(pedidos[0]) === `prova(${integrity.finishHash('r1', jogada)})`,
      provaDe(pedidos[0])
    );
    check('e a preparacao com o Google acontece uma vez so', preparacoes === 1, `${preparacoes}`);

    // ---- partida que nao rendeu nada nao gasta prova (a cota do dia e do Google)
    pedidos.length = 0;
    const antesDeZero = provas;
    await economy.finishRun('r2', { points: 0, coinOrdinals: [], flightMs: 1000 });
    check(
      'partida que nao rendeu nada nao gasta prova nenhuma',
      provaDe(pedidos[0]) === undefined && provas === antesDeZero
    );

    // ---- provedor vencido: prepara de novo e a prova sai
    pedidos.length = 0;
    vencer = 1;
    await economy.finishRun('r3', { points: 12, coinOrdinals: [], flightMs: 9000 });
    check(
      'provedor vencido: o app prepara de novo e a prova ainda sai',
      typeof provaDe(pedidos[0]) === 'string' && preparacoes === 2,
      `${preparacoes} preparacoes`
    );

    // ---- fechamento guardado sem rede sobe com uma prova NOVA
    responder = () => ({ falha: 'TypeError' });
    const guardada = { points: 8, coinOrdinals: [1], flightMs: 5000 };
    const semRede = await economy.finishRun('r4', guardada);
    check('sem rede, o fechamento fica guardado', !semRede.ok && semRede.offline === true);

    pedidos.length = 0;
    const antesDaSubida = provas;
    responder = (p) =>
      p.path === '/v1/runs/start'
        ? {
            status: 200,
            body: {
              run: { id: 'r5', seed: 7, coinEvery: 3, maxContinues: 1 },
              wallet: carteira,
            },
          }
        : fechou;
    await economy.startRun();
    const subiu = pedidos.find((p) => p.path === '/v1/runs/r4/finish');
    check(
      'o fechamento guardado sobe com uma prova nova (a antiga ja teria vencido)',
      provas === antesDaSubida + 1 &&
        provaDe(subiu) === `prova(${integrity.finishHash('r4', guardada)})`,
      provaDe(subiu)
    );

    // ---- sem o modulo do Google, a partida sobe assim mesmo
    integrity.__setProvider(null);
    pedidos.length = 0;
    responder = () => fechou;
    const semModulo = await economy.finishRun('r6', { points: 5, coinOrdinals: [], flightMs: 3000 });
    check(
      'sem o modulo do Google no aparelho, a partida sobe sem prova em vez de travar',
      semModulo.ok && provaDe(pedidos[0]) === undefined
    );
  } finally {
    global.fetch = fetchOriginal;
    integrity.__setProvider(undefined);
    economy.resetEconomyState();
    identity.resetPlayerState();
  }
}

// ------------------------------------------------- 11. compra com dinheiro

/**
 * A compra com dinheiro dos passaros (billing.js). O Google Play e um dublê; o
 * servidor, um `fetch` de mentira. O que se confere e a ordem das coisas: o
 * passaro so chega pela resposta do servidor, a compra so e fechada no aparelho
 * DEPOIS disso, e compra que ficou pelo caminho sobe na abertura seguinte.
 */
async function billingSection() {
  section('Compra com dinheiro');

  const pedidos = [];
  let responder = () => ({ status: 200, body: {} });
  const fetchOriginal = global.fetch;
  global.fetch = async (url, options = {}) => {
    const pedido = {
      path: String(url).replace(FAKE_API, ''),
      corpo: options.body ? JSON.parse(options.body) : null,
    };
    pedidos.push(pedido);
    const r = responder(pedido);
    if (r.falha) throw Object.assign(new Error('sem rede'), { name: r.falha });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };

  const catalogo = {
    birds: [
      { id: 'classic', name: 'Major', price: 0, powers: [] },
      { id: 'frost', name: 'Geada', price: 150, productId: 'bird_frost', powers: [] },
      { id: 'comet', name: 'Cometa', price: 0, productId: 'bird_comet', powers: [] },
    ],
    skinSlots: [
      { id: 'cap', name: 'Bonés' },
      { id: 'glasses', name: 'Óculos' },
    ],
    skins: [
      { id: 'cap_red', name: 'Boné Vermelho', slot: 'cap', price: 8, productId: 'skin_cap_red' },
      { id: 'glasses_3d', name: 'Óculos 3D', slot: 'glasses', price: 8, productId: 'skin_glasses_3d' },
    ],
    items: { shield: { price: 60 }, continue: { price: 100 } },
    rules: { maxLives: 5, coinEvery: 3, stageLength: 100, stageBonus: 10, maxContinuesPerRun: 1 },
  };
  let donos = ['classic'];
  let donasSkins = [];
  const carteira = () => ({
    coins: 0, lives: 5, maxLives: 5, shields: 0, continues: 0, flightMs: 0,
    equippedBird: 'classic', ownedBirds: donos.slice(), ownedSkins: donasSkins.slice(), equippedSkins: {},
  });
  // O servidor entregando a compra: o passaro (birdId) ou a skin (skinId).
  const entregar = (p) => {
    if (p.corpo.skinId) {
      donasSkins = [...new Set([...donasSkins, p.corpo.skinId])];
      return { status: 200, body: { wallet: carteira(), skinId: p.corpo.skinId } };
    }
    donos = [...new Set([...donos, p.corpo.birdId])];
    return { status: 200, body: { wallet: carteira(), birdId: p.corpo.birdId } };
  };

  // O dublê do Google Play: guarda quem escuta, e responde como a loja.
  let aoComprar = null;
  let aoErrar = null;
  let proxima = { purchaseState: 'purchased' }; // o que a proxima compra devolve
  const pedidosAoGoogle = [];
  const fechadas = [];
  let guardadas = [];
  const google = {
    initConnection: async () => true,
    purchaseUpdatedListener: (cb) => (aoComprar = cb),
    purchaseErrorListener: (cb) => (aoErrar = cb),
    fetchProducts: async ({ skus }) =>
      // O Google so devolve o que existe (e esta ativo) no Play Console.
      skus
        .filter((id) => !id.includes('nao_tem'))
        .map((id) => ({ id, displayPrice: id === 'bird_comet' ? 'R$ 19,90' : 'R$ 4,99' })),
    requestPurchase: async (args) => {
      pedidosAoGoogle.push(args);
      const sku = args.request.google.skus[0];
      setTimeout(() => {
        if (proxima.cancelar) aoErrar({ code: 'user-cancelled' });
        else aoComprar({ productId: sku, purchaseToken: `tok-${sku}`, ...proxima });
      }, 0);
      return null;
    },
    finishTransaction: async ({ purchase }) => {
      fechadas.push(purchase.purchaseToken);
    },
    getAvailablePurchases: async () => guardadas,
    isUserCancelledError: (e) => Boolean(e && e.code === 'user-cancelled'),
  };

  try {
    identity.resetPlayerState();
    economy.resetEconomyState();
    disk.clear();
    const jogador = await identity.initPlayer();
    billing.__setIap(google);
    responder = (p) => {
      if (p.path === '/v1/catalog') return { status: 200, body: catalogo };
      if (p.path === '/v1/me/wallet') return { status: 200, body: { wallet: carteira() } };
      if (p.path === '/v1/shop/purchase') return entregar(p);
      return { status: 404, body: {} };
    };
    await economy.refresh();

    // ---- precos: vem do Google Play
    await billing.loadPrices(catalogo.birds);
    check(
      'o preco em reais vem do Google Play',
      billing.priceOf('bird_comet') === 'R$ 19,90' && billing.priceOf('bird_frost') === 'R$ 4,99'
    );

    // ---- compra paga: o servidor entrega, e so depois ela fecha no aparelho
    pedidos.length = 0;
    const cometa = catalogo.birds[2];
    const paga = await billing.buyBird(cometa);
    const aoServidor = pedidos.find((p) => p.path === '/v1/shop/purchase');
    check('compra paga: o passaro chega pela resposta do servidor', paga.ok === true && economy.economyNow().wallet.ownedBirds.includes('comet'));
    check(
      '...que recebe o passaro e o token da compra',
      aoServidor && aoServidor.corpo.birdId === 'comet' && aoServidor.corpo.purchaseToken === 'tok-bird_comet'
    );
    check('...e so entao a compra e fechada no aparelho', fechadas.includes('tok-bird_comet'));
    check(
      'a compra vai amarrada ao resumo do codigo do jogador, nunca ao codigo',
      pedidosAoGoogle[0].request.google.obfuscatedAccountId === sha256Hex(jogador.id)
    );

    // ---- skin com dinheiro: o mesmo caminho, e o servidor recebe o id da skin
    await billing.loadPrices([...catalogo.birds, ...catalogo.skins]);
    pedidos.length = 0;
    const bone = catalogo.skins[0];
    const skinPaga = await billing.buySkin(bone);
    const skinAoServidor = pedidos.find((p) => p.path === '/v1/shop/purchase');
    check('o preco da skin tambem vem do Google Play', billing.priceOf('skin_cap_red') === 'R$ 4,99');
    await billing.loadPrices([{ productId: 'skin_que_o_google_nao_tem' }]);
    check(
      'produto que o Google Play nao devolve (inativo, recem-criado) nao fica carregando para sempre',
      billing.priceLoading('skin_que_o_google_nao_tem') === false && billing.priceOf('skin_que_o_google_nao_tem') === null
    );
    check('...e produto ainda nao consultado espera o preco', billing.priceLoading('skin_nunca_consultada') === true);
    check(
      'skin paga: chega pela resposta do servidor, que recebe o id da skin e o token',
      skinPaga.ok === true &&
        economy.economyNow().wallet.ownedSkins.includes('cap_red') &&
        skinAoServidor &&
        skinAoServidor.corpo.skinId === 'cap_red' &&
        !('birdId' in skinAoServidor.corpo) &&
        skinAoServidor.corpo.purchaseToken === 'tok-skin_cap_red',
      JSON.stringify(skinAoServidor && skinAoServidor.corpo)
    );
    check('...e so entao a compra da skin fecha no aparelho', fechadas.includes('tok-skin_cap_red'));

    // ---- sem rede na hora de entregar: nao fecha, sobe na proxima abertura
    responder = (p) => (p.path === '/v1/shop/purchase' ? { falha: 'TypeError' } : { status: 200, body: { wallet: carteira() } });
    const semRede = await billing.buyBird(catalogo.birds[1]);
    check(
      'pagou sem rede: o jogador le que o passaro chega quando a internet voltar',
      !semRede.ok && semRede.error === billing.BILLING_MESSAGES.later
    );
    check('...e a compra NAO fecha no aparelho sem o servidor ter entregue', !fechadas.includes('tok-bird_frost'));

    // ---- pagamento pendente (boleto): nem vai ao servidor, nem fecha
    pedidos.length = 0;
    proxima = { purchaseState: 'pending' };
    const pendente = await billing.buyBird(catalogo.birds[1]);
    check(
      'pagamento pendente: avisa sem entregar nem fechar nada',
      pendente.pending === true && !pedidos.some((p) => p.path === '/v1/shop/purchase') && !fechadas.includes('tok-bird_frost')
    );

    // ---- desistiu na tela do Google
    proxima = { cancelar: true };
    const desistiu = await billing.buyBird(catalogo.birds[1]);
    check('desistir na tela de pagamento nao vira erro nem compra', desistiu.cancelled === true && !desistiu.error);

    // ---- abertura seguinte: a compra que ficou pelo caminho sobe
    proxima = { purchaseState: 'purchased' };
    responder = (p) =>
      p.path === '/v1/shop/purchase' ? entregar(p) : { status: 200, body: { wallet: carteira() } };
    guardadas = [
      { productId: 'bird_frost', purchaseToken: 'tok-bird_frost', purchaseState: 'purchased', isAcknowledgedAndroid: false },
      { productId: 'bird_comet', purchaseToken: 'tok-bird_comet', purchaseState: 'purchased', isAcknowledgedAndroid: true },
    ];
    pedidos.length = 0;
    const chegaram = await billing.syncPurchases();
    const subiram = pedidos.filter((p) => p.path === '/v1/shop/purchase').map((p) => p.corpo.birdId);
    check(
      'na abertura seguinte, a compra que ficou pelo caminho chega',
      chegaram === 1 && JSON.stringify(subiram) === JSON.stringify(['frost']) && fechadas.includes('tok-bird_frost'),
      JSON.stringify(subiram)
    );
    check('...e a que ja estava na conta e fechada nem vai ao servidor', !subiram.includes('comet'));

    guardadas = [
      { productId: 'skin_glasses_3d', purchaseToken: 'tok-skin_glasses_3d', purchaseState: 'purchased', isAcknowledgedAndroid: false },
    ];
    pedidos.length = 0;
    const skinsChegaram = await billing.syncPurchases();
    const skinSubiu = pedidos.find((p) => p.path === '/v1/shop/purchase');
    check(
      '...e a skin paga que ficou pelo caminho tambem chega',
      skinsChegaram === 1 && skinSubiu && skinSubiu.corpo.skinId === 'glasses_3d',
      JSON.stringify(skinSubiu && skinSubiu.corpo)
    );

    // ---- sem o modulo do Google (web, iPhone, build antiga)
    billing.__setIap(null);
    const semModulo = await billing.buyBird(cometa);
    check(
      'sem o Google Play no aparelho, a compra com dinheiro nem aparece',
      billing.isAvailable() === false && !semModulo.ok && semModulo.error === billing.BILLING_MESSAGES.unavailable
    );
    check(
      '...e o texto nao fala de bastidor (Google, servidor)',
      Object.values(billing.BILLING_MESSAGES).every((t) => !/google|servidor/i.test(t))
    );
  } finally {
    global.fetch = fetchOriginal;
    billing.__setIap(undefined);
    economy.resetEconomyState();
    identity.resetPlayerState();
  }
}

// ------------------------------------------------------------- 12. as skins

/**
 * O desenho das skins (src/game/skins.js) contra o catalogo do servidor
 * (server/catalog.go). O servidor vende pelo id; o app desenha pelo id. Skin
 * vendida sem desenho some da loja do app — e desenho sem skin no servidor e
 * codigo morto. Aqui se confere que as duas listas andam juntas, e que o
 * encaixe de cada uma e o mesmo nas duas pontas.
 */
function skinsSection() {
  section('Skins: o desenho e o catalogo do servidor');

  const { SKIN_LOOKS, NO_SKINS, wornSkins } = require(path.join(BUILD, 'src/game/skins.js'));
  const fonte = fs.readFileSync(path.join(ROOT, 'server/catalog.go'), 'utf8').replace(/\r\n/g, '\n');
  const bloco = (inicio) => {
    const de = fonte.indexOf(inicio);
    return de < 0 ? '' : fonte.slice(de, fonte.indexOf('\n}\n', de));
  };

  const doServidor = [...bloco('var Skins = []SkinOffer{').matchAll(/ID: "([^"]+)",[^\n]*?Slot: "([^"]+)"/g)].map(
    (m) => ({ id: m[1], slot: m[2] })
  );
  const encaixes = [...bloco('var SkinSlots = []SkinSlot{').matchAll(/ID: "([^"]+)"/g)].map((m) => m[1]);

  check('o catalogo do servidor tem skins e encaixes', doServidor.length > 0 && encaixes.length > 0);
  const semDesenho = doServidor.filter((s) => !SKIN_LOOKS[s.id]);
  check('toda skin do servidor tem desenho no app', semDesenho.length === 0, semDesenho.map((s) => s.id).join(', '));
  const trocadas = doServidor.filter((s) => SKIN_LOOKS[s.id] && SKIN_LOOKS[s.id].slot !== s.slot);
  check('...no mesmo encaixe nas duas pontas', trocadas.length === 0, trocadas.map((s) => s.id).join(', '));
  const orfas = Object.keys(SKIN_LOOKS).filter((id) => !doServidor.some((s) => s.id === id));
  check('...e todo desenho e de uma skin que o servidor vende', orfas.length === 0, orfas.join(', '));
  check(
    'cada encaixe tem pelo menos 3 skins',
    encaixes.every((e) => doServidor.filter((s) => s.slot === e).length >= 3),
    encaixes.map((e) => `${e}: ${doServidor.filter((s) => s.slot === e).length}`).join(', ')
  );

  const vestidas = wornSkins({ cap: 'cap_red', glasses: 'cap_neon', wings: 'asa_inventada' });
  check(
    'no corpo so entra skin conhecida, no encaixe dela',
    Object.keys(vestidas).join(',') === 'cap' && vestidas.cap === SKIN_LOOKS.cap_red
  );
  check('sem skin nenhuma, o mesmo objeto vazio de sempre', wornSkins(null) === NO_SKINS && wornSkins({}) === NO_SKINS);
}

// ------------------------------------------------------ 13. o tema do Android

/**
 * O tema que o Android recebe (plugins/withEdgeToEdgeBars.js). Do Android 15 em
 * diante o jogo desenha de ponta a ponta, e o sistema ignora quem tenta pintar a
 * barra de status ou a de navegacao — quem ainda declara esses parametros leva
 * aviso do Play Console. O plugin tira todos; aqui se confere que ele continua
 * tirando, que o resto do tema fica de pe e que o app.json chama os dois plugins
 * do Android.
 */
function androidThemeSection() {
  section('O tema do Android');

  const plugin = require(path.join(ROOT, 'plugins/withEdgeToEdgeBars.js'));
  const item = (name, value) => ({ _: value, $: { name } });

  // O tema do jeito que o Expo entrega, antes do plugin.
  const tema = {
    resources: {
      style: [
        {
          $: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' },
          item: [
            item('android:editTextBackground', '@drawable/rn_edit_text_material'),
            item('colorPrimary', '@color/colorPrimary'),
            item('android:statusBarColor', '@android:color/transparent'),
            item('android:navigationBarColor', '@android:color/transparent'),
            item('android:windowBackground', '@color/activityBackground'),
          ],
        },
      ],
    },
  };

  const itens = plugin.ajustaTema(tema).resources.style[0].item;
  const nomes = itens.map((i) => i.$.name);
  const valor = (nome) => (itens.find((i) => i.$.name === nome) || {})._;

  check(
    'o tema sai sem os parametros de barra descontinuados no Android 15',
    plugin.PARAMETROS_DESCONTINUADOS.every((p) => !nomes.includes(p))
  );
  check(
    '...e o resto do tema fica de pe',
    ['colorPrimary', 'android:windowBackground', 'android:editTextBackground'].every((p) =>
      nomes.includes(p)
    )
  );
  check(
    '...e ate o Android 14 a barra de status continua com o azul do jogo',
    valor('colorPrimaryDark') === plugin.COR_DA_BARRA
  );

  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
  const plugins = (app.plugins || []).filter((p) => typeof p === 'string');
  check('o app.json chama o plugin do tema', plugins.includes('./plugins/withEdgeToEdgeBars'));
  check(
    'o app.json marca o jogo como jogo (e o que segura o retrato em tela grande)',
    plugins.includes('./plugins/withGameCategory')
  );
  check('o jogo abre em retrato', app.orientation === 'portrait');
}

// ------------------------------------------------------------ 14. os idiomas

/**
 * Os idiomas do jogo (src/i18n). Os arquivos de traducao precisam ter TODAS as
 * chaves do portugues, com os mesmos {marcadores} e as formas de plural de cada
 * idioma — texto faltando vira a chave crua na tela, e marcador trocado vira
 * "{name}" no lugar do nome. Aqui tambem: a deteccao do idioma do celular, o
 * plural de cada idioma, os erros do servidor e o que vem do catalogo.
 */
function languagesSection() {
  section('Idiomas');

  const catalog = require(path.join(BUILD, 'src/i18n/catalog.js'));
  const pastas = path.join(ROOT, 'src/i18n/locales');
  const FORMAS = ['zero', 'one', 'two', 'few', 'many', 'other'];
  const PRECISA = {
    pt: ['one', 'other'], en: ['one', 'other'], es: ['one', 'other'], it: ['one', 'other'],
    de: ['one', 'other'], fr: ['one', 'other'], ru: ['one', 'few', 'many', 'other'],
    zh: ['other'], ja: ['other'], ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  };
  const folhas = (no, prefixo = '', saida = {}) => {
    for (const [k, v] of Object.entries(no)) {
      const chave = prefixo ? `${prefixo}.${k}` : k;
      if (typeof v === 'string' || Array.isArray(v) || i18n.isPluralNode(v)) saida[chave] = v;
      else if (v && typeof v === 'object') folhas(v, chave, saida);
      else saida[chave] = v;
    }
    return saida;
  };
  const marcas = (v) => {
    const textos = typeof v === 'string' ? [v] : Array.isArray(v) ? v : Object.values(v);
    return new Set(textos.flatMap((x) => [...String(x).matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
  };

  const base = folhas(JSON.parse(fs.readFileSync(path.join(pastas, 'pt.json'), 'utf8')));
  check('os dez idiomas pedidos estao no jogo', i18n.LANGUAGES.map((l) => l.code).join(',') === 'pt,en,es,it,de,fr,ru,zh,ja,ar');
  for (const { code } of i18n.LANGUAGES) {
    const dic = folhas(JSON.parse(fs.readFileSync(path.join(pastas, `${code}.json`), 'utf8')));
    const faltam = Object.keys(base).filter((k) => !(k in dic));
    const sobram = Object.keys(dic).filter((k) => !(k in base));
    const marcadores = Object.keys(base).filter((k) => {
      if (!(k in dic)) return false;
      const a = marcas(base[k]);
      const b = marcas(dic[k]);
      return [...b].some((m) => !a.has(m)) || [...a].some((m) => m !== 'count' && !b.has(m));
    });
    const plurais = Object.keys(dic).filter(
      (k) => i18n.isPluralNode(dic[k]) && PRECISA[code].some((f) => !(f in dic[k]))
    );
    check(
      `${code}: todas as chaves, os mesmos marcadores e o plural do idioma`,
      !faltam.length && !sobram.length && !marcadores.length && !plurais.length,
      [faltam.length && `faltam ${faltam.slice(0, 5)}`, sobram.length && `sobram ${sobram.slice(0, 5)}`,
        marcadores.length && `marcadores ${marcadores.slice(0, 5)}`, plurais.length && `plural ${plurais.slice(0, 5)}`]
        .filter(Boolean).join('; ')
    );
  }

  // ---- o idioma do celular
  const detecta = i18n.detectDeviceLanguage;
  check('celular em pt-BR abre em portugues', detecta(['pt-BR']) === 'pt');
  check('...zh-Hant-TW em chines e ja_JP em japones', detecta(['zh-Hant-TW']) === 'zh' && detecta(['ja_JP']) === 'ja');
  check('celular em coreano (idioma que o jogo nao tem) abre em ingles', detecta(['ko-KR']) === 'en');
  check('...mas vale o segundo idioma do celular, se o jogo tiver', detecta(['ko-KR', 'fr-CA']) === 'fr');
  check('leitura que falhou (nada, lixo) cai no ingles', detecta([]) === 'en' && detecta(null) === 'en' && detecta([undefined, 42]) === 'en');
  check(
    'a preferencia salva: idioma escolhido vale; automatico (ou lixo) segue o celular',
    i18n.resolveLanguage('de') === 'de' && i18n.resolveLanguage('auto') === detecta() && i18n.resolveLanguage('xx') === detecta()
  );

  // ---- plural de cada idioma
  const cat = (code, ns) => ns.map((n) => i18n.pluralCategory(code, n)).join(',');
  check('plural do russo', cat('ru', [1, 2, 5, 11, 21, 22, 112]) === 'one,few,many,many,one,few,many', cat('ru', [1, 2, 5, 11, 21, 22, 112]));
  check('plural do arabe', cat('ar', [0, 1, 2, 3, 11, 100]) === 'zero,one,two,few,many,other', cat('ar', [0, 1, 2, 3, 11, 100]));
  check('frances: 0 e 1 no singular; portugues: so o 1', cat('fr', [0, 1, 2]) === 'one,one,other' && cat('pt', [0, 1, 2]) === 'other,one,other');

  try {
    // ---- textos
    i18n.setLanguage('pt');
    check('portugues: "1 moeda", "5 moedas"', i18n.t('common.coins', { count: 1 }) === '1 moeda' && i18n.t('common.coins', { count: 5 }) === '5 moedas');
    check('chave que nao existe aparece crua (e o teste acima garante que nao falta nenhuma)', i18n.t('nao.existe') === 'nao.existe');
    i18n.setLanguage('ru');
    check('russo: "3 монеты", "5 монет"', i18n.t('common.coins', { count: 3 }) === '3 монеты' && i18n.t('common.coins', { count: 5 }) === '5 монет');
    i18n.setLanguage('ja');
    check('japones: segundos com ponto e "秒"', i18n.formatSeconds(2.5) === '2.5秒', i18n.formatSeconds(2.5));
    i18n.setLanguage('de');
    check('alemao: decimal com virgula', i18n.formatSeconds(2.5) === '2,5 s', i18n.formatSeconds(2.5));

    // ---- erros do servidor
    i18n.setLanguage('pt');
    check(
      'portugues: o erro e o texto do servidor; sem texto, a traducao do codigo',
      i18n.errorText({ code: 'not_enough_coins', error: 'moedas insuficientes' }) === 'moedas insuficientes' &&
        i18n.errorText({ code: 'offline' }) === i18n.t('errors.offline')
    );
    i18n.setLanguage('en');
    check(
      'ingles: o codigo vira a traducao, nunca a frase em portugues',
      i18n.errorText({ code: 'not_enough_coins', error: 'moedas insuficientes' }) === 'Not enough coins.' &&
        i18n.errorText({ code: 'codigo_novo', error: 'algo em portugues' }) === i18n.t('errors.generic')
    );

    // ---- o que vem do catalogo
    const ima = {
      id: 'magnet',
      name: 'Ímã',
      params: { activeSeconds: 4, cooldownSeconds: 10, reach: 5 },
      levelValues: [4, 5, 6, 7, 7.5, 8],
    };
    i18n.setLanguage('pt');
    check(
      'portugues: a frase do poder sai igual a do servidor',
      catalog.powerText(ima).description === 'Puxa as moedas por perto: 4 s ligado (8 s com 5 estrelas), 10 s recarregando.',
      catalog.powerText(ima).description
    );
    i18n.setLanguage('en');
    check(
      'ingles: a mesma frase, com os numeros do servidor',
      catalog.powerText(ima).description === 'Pulls in nearby coins: 4 s on (8 s with 5 stars), 10 s to recharge.',
      catalog.powerText(ima).description
    );
    check(
      'poder que o app nao conhece fica com o texto do servidor',
      catalog.powerText({ id: 'novo', name: 'Novo', description: 'Faz algo.' }).name === 'Novo'
    );
    check(
      'nome do passaro traduzido; passaro novo do servidor fica com o nome dele',
      catalog.birdName({ id: 'frost', name: 'Geada' }) === 'Frost' && catalog.birdName({ id: 'novo', name: 'Novato' }) === 'Novato'
    );
    check('a data da rodada em ingles', season.seasonLabel(season.seasonAt(new Date('2026-09-09T12:00:00Z'))) === 'September 6–13',
      season.seasonLabel(season.seasonAt(new Date('2026-09-09T12:00:00Z'))));
    check('o tempo de voo em ingles', formatFlightTime(3 * 3600000 + 7 * 60000) === '3h 07m', formatFlightTime(3 * 3600000 + 7 * 60000));

    // ---- todo id do catalogo do servidor tem traducao
    const fonte = fs.readFileSync(path.join(ROOT, 'server/catalog.go'), 'utf8').replace(/\r\n/g, '\n');
    const bloco = (inicio) => {
      const de = fonte.indexOf(inicio);
      return de < 0 ? '' : fonte.slice(de, fonte.indexOf('\n}\n', de));
    };
    const ids = (inicio) => [...bloco(inicio).matchAll(/^\s*\{ID: "?([^",]+)"?,/gm)].map((m) => m[1]);
    const passaros = ids('var Birds = []BirdOffer{').map((id) => (id === 'DefaultBird' ? 'classic' : id));
    const semNome = [
      ...passaros.filter((id) => !i18n.has(`birds.${id}.name`)),
      ...ids('var Skins = []SkinOffer{').filter((id) => !i18n.has(`skins.${id}.name`)),
      ...ids('var SkinSlots = []SkinSlot{').filter((id) => !i18n.has(`skinSlots.${id}`)),
      ...STAGES.map((st) => st.id).filter((id) => !i18n.has(`stages.${id}`)),
    ];
    check(
      'todo passaro, skin, encaixe e fase tem nome traduzido',
      passaros.length >= 6 && semNome.length === 0,
      semNome.join(', ') || `${passaros.length} passaros`
    );
  } finally {
    i18n.setLanguage('pt');
  }
}

// ------------------------------------------- 15. a Home nunca fica so com o fundo

/**
 * Um React de mentira, so o bastante para rodar UM hook no Node: estado, refs,
 * callbacks e os dois tipos de efeito, na ordem do React de verdade — os de
 * layout junto com o desenho; os comuns depois, mas sempre antes do desenho
 * seguinte, com as atualizacoes deles entrando no FIM da fila.
 */
function reactDeMentira() {
  let c = null; // o componente desenhando agora
  const iguais = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const roda = (lista) => {
    for (const f of lista.splice(0)) f();
  };
  const efeito = (tipo) => (fn, deps) => {
    const i = c.cursor++;
    const antes = c.slots[i];
    if (antes && iguais(antes.deps, deps)) return;
    const slot = { deps, limpa: antes ? antes.limpa : null };
    c.slots[i] = slot;
    c[tipo].push(() => {
      if (slot.limpa) slot.limpa();
      const r = fn();
      slot.limpa = typeof r === 'function' ? r : null;
    });
  };

  const React = {
    useState(inicial) {
      const i = c.cursor++;
      if (!(i in c.slots)) {
        const comp = c;
        const slot = { valor: typeof inicial === 'function' ? inicial() : inicial };
        slot.set = (v) => comp.fila.push([slot, v]);
        c.slots[i] = slot;
      }
      return [c.slots[i].valor, c.slots[i].set];
    },
    useRef(inicial) {
      const i = c.cursor++;
      if (!(i in c.slots)) c.slots[i] = { current: inicial };
      return c.slots[i];
    },
    useCallback(fn, deps) {
      const i = c.cursor++;
      const s = c.slots[i];
      if (s && iguais(s.deps, deps)) return s.fn;
      c.slots[i] = { fn, deps };
      return fn;
    },
    useEffect: efeito('passivos'),
    useLayoutEffect: efeito('layout'),
  };

  function monta(hook, args) {
    const comp = { slots: [], fila: [], layout: [], passivos: [], args, saida: null };
    comp.rodaPassivos = () => roda(comp.passivos);
    comp.desenha = () => {
      roda(comp.passivos); // o React esvazia os efeitos pendentes antes de desenhar de novo
      for (let volta = 0; volta < 50; volta++) {
        for (const [slot, v] of comp.fila.splice(0)) slot.valor = typeof v === 'function' ? v(slot.valor) : v;
        c = comp;
        comp.cursor = 0;
        comp.saida = hook(...comp.args);
        c = null;
        roda(comp.layout);
        if (comp.fila.length === 0) return; // efeito de layout que mexe em estado desenha de novo na hora
      }
      throw new Error('desenho sem fim');
    };
    comp.desmonta = () => {
      roda(comp.passivos);
      for (const s of comp.slots) if (s && s.limpa) s.limpa();
    };
    comp.desenha();
    return comp;
  }

  return { React, monta };
}

/** Carrega um modulo ja compilado com o React de mentira no lugar do de verdade (e sem cache). */
function comReactDeMentira(arquivo, React) {
  const caminhoReact = require.resolve('react', { paths: [path.dirname(arquivo)] });
  const antes = require.cache[caminhoReact];
  require.cache[caminhoReact] = { id: caminhoReact, filename: caminhoReact, loaded: true, exports: React };
  delete require.cache[require.resolve(arquivo)];
  try {
    return require(arquivo);
  } finally {
    if (antes) require.cache[caminhoReact] = antes;
    else delete require.cache[caminhoReact];
  }
}

/**
 * A tela de mentira em volta do useFitScale: desenha o bloco na escala pedida e
 * manda o onLayout SO quando a altura muda — como o Android e a web fazem.
 * `ordem` decide quem chega primeiro depois de cada desenho: os efeitos comuns
 * ('efeitos') ou a medida ('medida'). No celular acontecem as duas.
 */
function telaDeMentira(useFitScale, monta, { alturaEm, disponivel, chave = 'a', ordem = 'efeitos', mede = true }) {
  const comp = monta(useFitScale, [disponivel, chave]);
  let medida = null;
  const t = {
    get escala() {
      return comp.saida.scale;
    },
    get visivel() {
      return comp.saida.ready;
    },
    get altura() {
      return alturaEm(comp.saida.scale);
    },
    /** Um quadro: efeitos e medida (na ordem pedida) e, se algo mudou, um desenho novo. */
    quadro() {
      if (ordem === 'efeitos') comp.rodaPassivos();
      const h = alturaEm(comp.saida.scale);
      const mediu = mede && h !== medida;
      if (mediu) {
        medida = h;
        comp.saida.onLayout({ nativeEvent: { layout: { height: h } } });
      }
      const mexeu = comp.fila.length > 0 || comp.passivos.length > 0;
      if (mexeu) comp.desenha();
      return mediu || mexeu;
    },
    /** Quadros ate nada mais mudar. Falso se nao assentou (a escala ficou pulando). */
    estabiliza(max = 30) {
      for (let i = 0; i < max; i++) if (!t.quadro()) return true;
      return false;
    },
    /** A tela de cima desenha de novo: outra altura disponivel, outra chave, outro conteudo. */
    muda({ disponivel: d = comp.args[0], chave: k = comp.args[1], conteudo } = {}) {
      if (conteudo) alturaEm = conteudo;
      comp.args = [d, k];
      comp.desenha();
    },
    desmonta: () => comp.desmonta(),
  };
  return t;
}

/**
 * O useFitScale (src/hooks/useFitScale.js), que encolhe a Home ate ela caber na
 * tela sem rolagem. A Home fica invisivel ate a primeira medida — e foi assim
 * que ela ficou SO COM O FUNDO para os jogadores: o hook escondia a tela de novo
 * a cada mudanca e esperava uma medida que nunca vinha (o onLayout so dispara
 * quando o tamanho muda), ou uma medida chegava antes do efeito que zerava a
 * conta e era apagada por ele. Aqui as duas corridas rodam de proposito.
 */
function fitScaleSection() {
  section('A Home sempre aparece inteira (useFitScale)');

  const arquivo = path.join(BUILD, 'src/hooks/useFitScale.js');
  const { React, monta } = reactDeMentira();
  const carrega = () => comReactDeMentira(arquivo, React);

  // Relogio de mentira: o prazo da primeira medida corre na hora que o teste quer.
  const reais = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let agora = 0;
  let timers = [];
  let proximoId = 0;
  global.setTimeout = (fn, ms = 0) => {
    timers.push({ id: ++proximoId, fn, quando: agora + ms });
    return proximoId;
  };
  global.clearTimeout = (id) => {
    timers = timers.filter((x) => x.id !== id);
  };
  const avanca = (ms) => {
    agora += ms;
    for (const x of timers.filter((y) => y.quando <= agora)) {
      timers = timers.filter((y) => y !== x);
      x.fn();
    }
  };

  try {
    const { nextFitScale, MIN_SCALE, REVEAL_TIMEOUT_MS } = carrega();
    check(
      'a escala fica entre o minimo legivel e o tamanho de projeto',
      nextFitScale(1, { altura: 10000, escala: 1 }, 600, true) === MIN_SCALE &&
        nextFitScale(0.5, { altura: 100, escala: 0.5 }, 600, true) === 1 &&
        nextFitScale(0.8, { altura: 100, escala: 0.8 }, 600, false) === 0.8 &&
        nextFitScale(1, null, 600, true) === 1 &&
        nextFitScale(1, { altura: 700, escala: 1 }, 0, true) === 1
    );

    // Celular grande (412x915): a Home cabe inteira na escala 1. A carteira chega
    // e o conteudo muda sem mudar de altura — nenhuma medida nova vem.
    {
      const t = telaDeMentira(carrega().default, monta, { alturaEm: (s) => Math.round(704 * s), disponivel: 883 });
      t.estabiliza();
      const antes = t.visivel;
      t.muda({ chave: 'carteira-chegou' });
      t.estabiliza();
      check(
        'celular grande: a carteira chega, o conteudo muda sem mudar de altura e a Home continua visivel',
        antes && t.visivel && t.escala === 1,
        `antes ${antes}, depois ${t.visivel}`
      );
    }

    // A corrida: a primeira medida chega ANTES dos efeitos comuns rodarem.
    {
      const t = telaDeMentira(carrega().default, monta, {
        alturaEm: (s) => Math.round(723 * s),
        disponivel: 608,
        ordem: 'medida',
      });
      t.estabiliza();
      check(
        'a medida que chega antes dos efeitos (a corrida do celular) nao apaga a Home',
        t.visivel && t.altura <= 608,
        `visivel ${t.visivel}, ${t.altura}px de 608`
      );
    }

    // Celular pequeno (360x640): encolhe ate caber, sem encolher demais.
    {
      const t = telaDeMentira(carrega().default, monta, { alturaEm: (s) => Math.round(723 * s), disponivel: 608 });
      const assentou = t.estabiliza();
      check(
        'celular pequeno: encolhe ate caber, em poucas medidas, sem sobrar espaco',
        assentou && t.visivel && t.altura <= 608 && t.altura >= 600,
        `${t.altura}px de 608, escala ${t.escala.toFixed(3)}`
      );
    }

    // Letra menor quebra menos linha: a 98% a frase cabe numa linha so e a
    // altura despenca — a conta manda crescer, a frase volta a quebrar...
    {
      const quebra = (s) => Math.round(700 * s + (s > 0.98 ? 19 * s : 0));
      const t = telaDeMentira(carrega().default, monta, { alturaEm: quebra, disponivel: 700 });
      const assentou = t.estabiliza();
      check(
        'texto que deixa de quebrar linha nao faz a escala pular para sempre',
        assentou && t.visivel && t.altura <= 700,
        `${assentou ? 'assentou' : 'nao assentou'}, ${t.altura}px de 700`
      );
    }

    // Um aviso aparece (a Home encolhe) e depois some: ela volta a crescer.
    {
      const t = telaDeMentira(carrega().default, monta, { alturaEm: (s) => Math.round(900 * s), disponivel: 800 });
      t.estabiliza();
      const comAviso = t.escala;
      t.muda({ chave: 'sem-aviso', conteudo: (s) => Math.round(700 * s) });
      t.estabiliza();
      check(
        'o aviso some e a Home volta ao tamanho de projeto',
        comAviso < 0.9 && t.escala === 1 && t.visivel,
        `${comAviso.toFixed(3)} -> ${t.escala.toFixed(3)}`
      );
    }

    // A altura disponivel muda (barras do sistema, rotacao) sem o bloco mudar de
    // tamanho: a conta e refeita na hora, sem esperar uma medida que nao viria.
    {
      const t = telaDeMentira(carrega().default, monta, { alturaEm: (s) => Math.round(704 * s), disponivel: 883 });
      t.estabiliza();
      t.muda({ disponivel: 600 });
      const naHora = t.altura;
      t.estabiliza();
      check(
        'a altura disponivel diminui: a Home encolhe na hora e continua visivel',
        naHora <= 600 && t.altura <= 600 && t.visivel,
        `${naHora}px, depois ${t.altura}px de 600`
      );
    }

    // A medida nunca chega: a Home aparece no prazo, um pouco grande se preciso.
    {
      const t = telaDeMentira(carrega().default, monta, {
        alturaEm: (s) => Math.round(723 * s),
        disponivel: 608,
        mede: false,
      });
      t.estabiliza();
      const antesDoPrazo = t.visivel;
      avanca(REVEAL_TIMEOUT_MS);
      t.estabiliza();
      check(
        `sem medida nenhuma, a Home aparece em ${REVEAL_TIMEOUT_MS} ms mesmo assim`,
        !antesDoPrazo && t.visivel
      );
    }

    // Voltando da partida, da loja ou do ranking: a Home monta de novo.
    {
      const { default: useFitScale } = carrega();
      const opcoes = { alturaEm: (s) => Math.round(723 * s), disponivel: 608 };
      const primeira = telaDeMentira(useFitScale, monta, opcoes);
      primeira.estabiliza();
      const escala = primeira.escala;
      primeira.desmonta();
      const volta = telaDeMentira(useFitScale, monta, opcoes);
      check(
        'voltando a Home, ela ja nasce visivel e no tamanho certo, sem esperar medida',
        volta.visivel && volta.escala === escala,
        `escala ${volta.escala.toFixed(3)}`
      );
      volta.desmonta();
    }
  } finally {
    global.setTimeout = reais.setTimeout;
    global.clearTimeout = reais.clearTimeout;
  }
}

// ---------------------------------------------- 16. a tela de carregamento

/**
 * A abertura (src/ui/bootProgress.js e LoadingScreen): a barra so anda para a
 * frente, enche quando tudo chega, e a tela sai quando a Home esta pronta — ou
 * no teto da espera, para um servidor mudo nunca prender o jogador.
 */
function bootSection() {
  section('A tela de carregamento da abertura');

  const boot = require(path.join(BUILD, 'src/ui/bootProgress.js'));
  const nada = { settings: false, player: false, server: false, home: false };
  const tudo = { settings: true, player: true, server: true, home: true };
  const semServidor = { ...tudo, server: false };

  const serie = [0, 200, 1000, 3000, 8000, 60000].map((ms) => boot.bootProgress(semServidor, ms));
  check(
    'sem resposta do servidor a barra anda sozinha, so para a frente, e nunca enche',
    serie.every((v, i) => i === 0 || v > serie[i - 1]) && serie[serie.length - 1] < 0.95,
    serie.map((v) => v.toFixed(2)).join(' ')
  );
  check(
    'cada passo que chega enche mais a barra, e tudo pronto a completa',
    boot.bootProgress(nada, 0) === 0 &&
      boot.bootProgress({ ...nada, settings: true }, 0) > 0 &&
      boot.bootProgress({ ...nada, settings: true, player: true }, 0) > boot.bootProgress({ ...nada, settings: true }, 0) &&
      boot.bootProgress(tudo, 0) === 1
  );
  check(
    'tudo pronto num instante: a tela ainda fica o minimo, para nao piscar',
    !boot.bootFinished(tudo, 100) && boot.bootFinished(tudo, boot.BOOT_MIN_MS)
  );
  check('a Home ainda nao se mediu: a tela espera', !boot.bootFinished({ ...tudo, home: false }, 2000));
  check(
    `servidor mudo: no teto da espera (${boot.BOOT_MAX_MS / 1000} s) a Home abre assim mesmo`,
    !boot.bootFinished(semServidor, boot.BOOT_MAX_MS - 1) &&
      boot.bootFinished(semServidor, boot.BOOT_MAX_MS) &&
      boot.bootFinished(nada, boot.BOOT_MAX_MS)
  );
  check(
    'a frase acompanha o passo que falta, e o servidor lento ganha aviso',
    boot.bootStep(nada, 0) === 'settings' &&
      boot.bootStep({ ...nada, settings: true }, 0) === 'player' &&
      boot.bootStep({ ...nada, settings: true, player: true }, 0) === 'server' &&
      boot.bootStep({ ...nada, settings: true, player: true }, boot.BOOT_SLOW_MS) === 'slow' &&
      boot.bootStep({ ...tudo, home: false }, 0) === 'menu' &&
      boot.bootStep(tudo, 0) === 'ready' &&
      boot.bootStep({ ...tudo, offline: true }, 0) === 'offline'
  );
  const frases = ['settings', 'player', 'server', 'slow', 'menu', 'ready', 'offline'];
  check(
    'toda frase da abertura tem texto',
    frases.every((f) => i18n.has(`boot.${f}`)),
    frases.filter((f) => !i18n.has(`boot.${f}`)).join(', ')
  );
}

seasonSection();
identitySection();
coinsSection();
skinsSection();
languagesSection();
androidThemeSection();
fitScaleSection();
bootSection();

economySection()
  .then(cloudSection)
  .then(integritySection)
  .then(billingSection)
  .catch((e) => {
    failures++;
    console.log(`  FALHOU  uma secao assincrona quebrou  (${e.message})`);
  })
  .then(() => {
    console.log(
      failures === 0 ? '\nTodos os testes passaram.\n' : `\n${failures} teste(s) falharam.\n`
    );
    process.exit(failures === 0 ? 0 : 1);
  });

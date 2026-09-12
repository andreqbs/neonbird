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
  'src/game/coins.js',
  'src/game/abilities.js',
  'src/game/World.js',
  'src/game/session.js',
  'src/services/season.js',
  'src/services/identity.js',
  'src/services/cloud.js',
  'src/services/economy.js',
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
    check('com a semente do servidor, a fila ja nasce com moeda', Boolean(p));
    if (p) {
      const y = w.coinY(p);
      const raio = L.birdRadius * coins.COIN_RADIUS;
      // Folga do tamanho do gelo (15% do vao) dos dois lados: a moeda nunca fica
      // dentro do bloco que sai do cano.
      check(
        'a moeda fica no vao, longe do gelo dos canos',
        y - raio > w.topEdgeOf(p) + p.gap * 0.15 && y + raio < w.bottomEdgeOf(p) - p.gap * 0.15,
        `${(y - p.gapCenter).toFixed(1)}px do centro do vao`
      );

      p.x = L.birdX;
      w.bird.position.y = y;
      w._collectCoins();
      check('encostar na moeda pega a moeda', w.coins === 1 && p.coin.taken === true, `${w.coins}`);
      check(
        'e guarda o numero do obstaculo, que e o que vai para o servidor',
        w.coinOrdinals[0] === p.ordinal
      );
      w._collectCoins();
      check('a mesma moeda nao conta duas vezes', w.coins === 1 && w.coinOrdinals.length === 1);
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
    check('nenhuma moeda repetida na lista', new Set(w.coinOrdinals).size === w.coinOrdinals.length);
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
    // Como se ja tivesse passado sete obstaculos: a fila vem numerada do 8.
    w.score = 7;
    w._layPillars();

    // Uma moeda pega a mao numa coluna que ainda estava por vir, para o teste
    // nao depender da mira do bot. Guarda-se o NUMERO: depois da nova chance a
    // mesma coluna e renumerada, e o que importa e o obstaculo, nao o objeto.
    const alvo = w.pillars.find((q) => q.coin && !q.coin.taken);
    const numeroDoAlvo = alvo ? alvo.ordinal : null;
    if (alvo) {
      alvo.x = L.birdX;
      w.bird.position.y = w.coinY(alvo);
      w._collectCoins();
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
      check(
        'moeda pega antes da queda nao reaparece',
        Boolean(mesma) && mesma.coin !== null && mesma.coin.taken === true,
        mesma ? `obstaculo ${numeroDoAlvo}` : 'a coluna nao voltou para a fila'
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
    const alvo = w.pillars.find((q) => q.coin && !q.coin.taken);
    if (alvo) {
      alvo.x = P.birdX;
      w.bird.position.y = w.coinY(alvo);
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
      girado.coins === pacote.coins &&
        JSON.stringify(girado.coinOrdinals) === JSON.stringify(pacote.coinOrdinals),
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
      { id: 'classic', name: 'Major', price: 0, ability: null },
      { id: 'frost', name: 'Geada', price: 150, ability: { id: 'frost', status: 'soon' } },
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
    const fechada = await economy.finishRun('r1', { points: 42, coinOrdinals: [2, 9, 10] });
    check(
      'fechar manda o placar e os numeros dos obstaculos das moedas',
      JSON.stringify(pedidos[0]?.corpo) === JSON.stringify({ points: 42, coinOrdinals: [2, 9, 10] }),
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

    // ---- respostas estranhas
    respostas = [{ status: 502, texto: '<html>Bad Gateway</html>' }];
    const proxy = await cloud.topGroups(10);
    check(
      'pagina de erro do proxy nao derruba o app e conta como sem conexao',
      !proxy.ok && proxy.offline === true
    );

    respostas = [{ falha: 'AbortError' }];
    const lento = await cloud.topGroups(10);
    check('servidor que demora demais tambem', !lento.ok && lento.offline === true);
  } finally {
    global.fetch = fetchOriginal;
    identity.resetPlayerState();
  }
}

seasonSection();
identitySection();
coinsSection();

economySection()
  .then(cloudSection)
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

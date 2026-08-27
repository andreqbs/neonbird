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
const BUILD = path.join(ROOT, 'node_modules', '.cache', 'neon-flyer-selftest');
const MODULES = [
  'src/game/constants.js',
  'src/game/layout.js',
  'src/game/World.js',
  'src/game/session.js',
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
const { PHASE } = require(path.join(BUILD, 'src/game/constants.js'));
const { captureSession, restoreSession } = require(path.join(BUILD, 'src/game/session.js'));

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALHOU'}  ${name}${extra ? `  (${extra})` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

/** Bot simples: mantem o passaro um pouco abaixo do centro do proximo vao. */
function autoplay(world, L, frames) {
  for (let f = 0; f < frames && world.phase !== PHASE.OVER; f++) {
    let target = L.playHeight / 2;
    let nearest = Infinity;
    for (const p of world.pillars) {
      const dx = p.x + L.pillarWidth / 2 - L.birdX;
      if (dx > -L.birdRadius && dx < nearest) {
        nearest = dx;
        target = p.gapCenter;
      }
    }
    if (world.bird.position.y > target + L.gap * 0.15 && world.bird.velocity.y >= -0.5) {
      world.flap();
    }
    world.update();
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

// ------------------------------------------------------------- 3. reset

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
  world.destroy();
}

console.log(
  failures === 0 ? '\nTodos os testes passaram.\n' : `\n${failures} teste(s) falharam.\n`
);
process.exit(failures === 0 ? 0 : 1);

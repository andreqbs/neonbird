import Matter from 'matter-js';
import {
  DRIFT_CHANCE,
  DRIFT_FRAMES,
  DRIFT_MIN_STEP,
  DRIFT_SAFE_SECONDS,
  FIXED_DT,
  HEAVY_FRAMES,
  HEAVY_INTERVAL,
  HEAVY_MULT,
  HEAVY_WARN_FRAMES,
  ICE_CHANCE,
  ICE_GAP_BITE,
  ICE_GROW_FRAMES,
  ICE_OUT_SECONDS,
  ICE_WARN_SECONDS,
  PHASE,
  SHIELD_FADE_FRAMES,
  STAGE_LENGTH,
} from './constants';
import { STAGE_COUNT, stageAt, trapsAt } from './stages';
import {
  COIN_RADIUS,
  LETTER_PIECES,
  LETTER_PITCH,
  LETTER_ROW_COUNT,
  coinLetterAt,
  coinOffset,
} from './coins';
import { NO_POWERS, combinePowers } from './powers';
import { capShape } from './caps';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const randRange = (a, b) => a + Math.random() * (b - a);
const randInt = ([a, b]) => Math.round(randRange(a, b));

// Contato continuo (raspar na coluna, passar pela tampa e depois pelo cano)
// rende varios 'collisionStart' seguidos. Duas absorcoes a menos de 8 frames
// contam como a mesma batida para efeito de som e estilhaco.
const ABSORB_COOLDOWN = 8;

// Ima: quanto do caminho ate o passaro a moeda puxada anda por passo. Um quarto
// chega em poucos frames, sem parecer teleporte.
const MAGNET_PULL = 0.25;

// Alcance maximo do ima, em raios do passaro — um teto para o numero que vem
// do servidor. Quem garante que ele nao puxa moeda de obstaculo que o passaro
// ainda nao tem como passar e a conta do placar em _pullCoins: o servidor so
// aceita moeda ate o obstaculo seguinte ao placar (server/coins.go).
export const MAGNET_MAX_REACH = 8;

/**
 * As moedas pegas, em pares [obstaculo, numero da moeda na letra], a partir da
 * lista que vai para o servidor (um numero de obstaculo por moeda). Serve para o
 * pacote que nao trouxe os pares: vale como se fossem as primeiras da letra.
 */
function piecesFromOrdinals(ordinals) {
  const vistos = new Map();
  return ordinals.map((o) => {
    const i = vistos.get(o) || 0;
    vistos.set(o, i + 1);
    return [o, i];
  });
}

/**
 * Mundo do jogo.
 *
 * Toda a fisica (gravidade, integracao da velocidade e deteccao de colisao)
 * roda no matter-js. O passaro e um corpo dinamico de verdade; as colunas sao
 * corpos estaticos marcados como `isSensor`, ou seja, o motor detecta o
 * contato e dispara `collisionStart`, mas nao empurra o passaro.
 *
 * A classe nao conhece React: quem desenha apenas le `birdY`, `pillars`, etc.
 *
 * FASES: a cada STAGE_LENGTH obstaculos o mundo congela em STAGE_CLEAR e
 * espera alguem chamar `nextStage()` (a tela faz isso depois do anuncio). Cada
 * fase traz sua propria velocidade e seu proprio vao, vindos de `stages.js`.
 *
 * MOEDAS: cada coluna tem um NUMERO na partida (1, 2, 3...) — o placar que o
 * jogador tera quando passar por ela. A semente que o servidor sorteou decide,
 * por esse numero, se ali tem moedas (coins.js): uma LETRA de moedas no vao, na
 * ordem de MAJOR FLYER, recomecando do M a cada fase. Cada moeda da letra se pega
 * separado; o mundo guarda o numero do obstaculo uma vez para cada moeda pega, e
 * e essa lista que o servidor confere ao fechar a partida.
 */
export default class World {
  constructor(layout) {
    this.layout = layout;

    // As letras de moedas (coins.js), em px deste layout: o espaco entre duas
    // moedas vizinhas e meia altura da letra, ja com o raio da moeda.
    const raioMoeda = layout.birdRadius * COIN_RADIUS;
    this._coinPitch = raioMoeda * LETTER_PITCH;
    this._letterHalf = ((LETTER_ROW_COUNT - 1) / 2) * this._coinPitch + raioMoeda;

    this.engine = Matter.Engine.create({ enableSleeping: false });
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 1;
    // O matter aplica aceleracao = gravity.y * gravity.scale * delta^2.
    // Convertendo a nossa gravidade (px/frame^2) para a escala do motor:
    this.engine.gravity.scale = layout.gravity / (FIXED_DT * FIXED_DT);

    this.bird = Matter.Bodies.circle(
      layout.birdX,
      layout.playHeight / 2,
      layout.birdRadius,
      {
        label: 'bird',
        frictionAir: 0,
        friction: 0,
        frictionStatic: 0,
        restitution: 0,
        inertia: Infinity, // trava a rotacao fisica; giramos so no visual
      }
    );

    // Cada coluna tem altura fixa (= altura da area de jogo) e sobra para fora
    // da tela. Assim o vao muda so pela POSICAO dos corpos, sem precisar
    // redimensionar geometria a cada reciclagem.
    this.pillars = [];
    const bodies = [this.bird];
    for (let i = 0; i < layout.pillarCount; i++) {
      const opts = { isStatic: true, isSensor: true, label: 'pillar' };
      const top = Matter.Bodies.rectangle(0, 0, layout.pillarWidth, layout.playHeight, opts);
      const bottom = Matter.Bodies.rectangle(0, 0, layout.pillarWidth, layout.playHeight, opts);
      // `ice` e `drift` sao as armadilhas daquela coluna: null quando ela e
      // limpa. `ordinal` e o numero dela na partida e `coin`, a moeda (ou null).
      this.pillars.push({
        top,
        bottom,
        x: 0,
        gapCenter: 0,
        gap: layout.gap,
        scored: false,
        ice: null,
        drift: null,
        driftDone: false,
        driftGlow: 0,
        ordinal: 0,
        coin: null,
      });
      bodies.push(top, bottom);
    }
    Matter.Composite.add(this.engine.world, bodies);

    // A economia da partida (ver setRun) e os poderes do passaro (ver
    // setPowers). Sem semente e treino: o voo e o mesmo, sem moeda nenhuma.
    this.run = { seed: null, coinEvery: 0 };
    this.powers = NO_POWERS;

    this._hit = false;
    this._onCollision = () => {
      this._hit = true;
    };
    Matter.Events.on(this.engine, 'collisionStart', this._onCollision);

    this.reset();
  }

  destroy() {
    Matter.Events.off(this.engine, 'collisionStart', this._onCollision);
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }

  reset() {
    const L = this.layout;
    this.phase = PHASE.READY;
    this.score = 0;
    this.frame = 0;
    this._hit = false;
    this.settled = false;
    this.stage = 0;
    this.shieldHits = 0;
    this._lastAbsorbFrame = -ABSORB_COOLDOWN;
    this._clearShield();
    this.applyStage();
    this._setHeavy(false);
    this.wing = 0;
    this.groundOffset = 0;
    this.skyOffset = 0;
    this.birdY = L.playHeight / 2;
    this.birdRotation = 0;

    // Moedas da partida: quantas, de quais obstaculos, e um contador que so
    // cresce — a tela o observa para tocar o som de cada moeda.
    // `coinOrdinals` tem o numero do obstaculo uma vez para cada moeda pega (e o
    // que vai para o servidor); `coinPieces`, os pares [obstaculo, moeda da
    // letra], para uma moeda pega nao voltar a aparecer.
    this.coins = 0;
    this.coinOrdinals = [];
    this.coinPieces = [];
    this._takenPieces = new Set();
    this.coinPickups = 0;
    this.continuesUsed = 0;
    // Tempo de voo: frames em PLAYING, e so eles (ver `flightMs`).
    this.flightFrames = 0;

    // O que os poderes mexem no voo (powers.js) — cada um liga o seu:
    //   speedFactor  1 = velocidade da fase; 0.8 = 20% mais lento
    //   ghost        atravessa os obstaculos
    //   magnetReach  alcance do ima, em px (0 = desligado)
    this.speedFactor = 1;
    this.ghost = false;
    this.magnetReach = 0;

    Matter.Body.setPosition(this.bird, { x: L.birdX, y: L.playHeight / 2 });
    Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });

    this._layPillars();
    this.powers.onRunStart(this);
  }

  /**
   * Liga a economia da partida. A semente e a frequencia das moedas vem do
   * servidor ao abrir a partida; `null` e treino (sem internet), sem moedas.
   */
  setRun(run) {
    this.run =
      run && Number.isFinite(run.seed)
        ? { seed: run.seed >>> 0, coinEvery: run.coinEvery || 0 }
        : { seed: null, coinEvery: 0 };
    for (const p of this.pillars) this._rollCoin(p);
  }

  /**
   * Os poderes do passaro desta partida (powers.js): a lista que o servidor
   * mandou junto com ela. Lista vazia = passaro sem poder.
   */
  setPowers(list) {
    this.powers = combinePowers(list);
    this.powers.onRunStart(this);
  }

  /** Os poderes com relogio, para o HUD: [{ id, name, active, level }]. */
  get powerStatus() {
    return this.powers.status();
  }

  /**
   * Aplica a fase atual: velocidade, vao e quantos pontos fecham a fase.
   * O multiplicador de velocidade e absoluto sobre a base do layout (fase 1 =
   * 1.0, fase 2 = 1.1 ...), e nao composto — e o que o projeto pediu.
   *
   * Passou da ultima fase? O visual e a velocidade param de subir (senao vira
   * injogavel), mas a contagem de fases continua, e o anuncio tambem.
   */
  applyStage() {
    const L = this.layout;
    const s = stageAt(this.stage);
    // O que esta fase permite acontecer. Fase 1 nao tem armadilha nenhuma.
    this.traps = trapsAt(this.stage);
    this.speed = L.speed * s.speed;
    // gapMin e o piso: nenhuma fase pode apertar o vao alem do jogavel.
    this.gap = Math.max(L.gap * s.gap, L.gapMin);
    this.stageTarget = (this.stage + 1) * STAGE_LENGTH;
    this._shapeCaps(s.pillar);
    for (const p of this.pillars) {
      p.gap = this.gap;
      this._syncPillar(p);
    }
  }

  /**
   * As tampas das colunas — a ponta larga do cano, virada para o vao — tambem
   * derrubam: sao parte do obstaculo. Cada fase desenha a sua com altura e
   * cantos proprios (caps.js), entao os corpos sao refeitos quando o formato
   * muda.
   */
  _shapeCaps(look) {
    const shape = capShape(this.layout.pillarWidth, look);
    const atual = this._capShape;
    const igual =
      atual && atual.width === shape.width && atual.height === shape.height && atual.radius === shape.radius;
    if (igual) return;
    this._capShape = shape;

    const world = this.engine.world;
    for (const p of this.pillars) {
      if (p.topCap) Matter.Composite.remove(world, [p.topCap, p.bottomCap]);
      p.topCap = this._capBody(shape);
      p.bottomCap = this._capBody(shape);
      Matter.Composite.add(world, [p.topCap, p.bottomCap]);
    }
  }

  _capBody(shape) {
    return Matter.Bodies.rectangle(0, 0, shape.width, shape.height, {
      isStatic: true,
      isSensor: true,
      label: 'pillar',
      ...(shape.radius > 0.5 ? { chamfer: { radius: shape.radius } } : null),
    });
  }

  /**
   * Alinha a fase ao placar. Cada fase tem exatamente STAGE_LENGTH obstaculos,
   * entao a fase e sempre `placar / STAGE_LENGTH` — usado ao retomar uma
   * partida que atravessou uma rotacao de tela.
   */
  syncStageToScore() {
    this.stage = Math.floor(this.score / STAGE_LENGTH);
    this.applyStage();
  }

  /**
   * Devolve a um mundo recem-criado o progresso de uma partida (area de jogo
   * refeita): placar, fase, moedas e tempo de voo. As colunas recomecam de fora
   * da tela, numeradas a partir do placar, e moeda ja pega nao reaparece.
   */
  restoreProgress({
    score = 0,
    coins,
    coinOrdinals = [],
    coinPieces,
    continuesUsed = 0,
    shield = false,
    flightFrames = 0,
  } = {}) {
    this.score = score;
    this.coinOrdinals = coinOrdinals.slice();
    this.coinPieces = coinPieces ? coinPieces.map(([o, i]) => [o, i]) : piecesFromOrdinals(this.coinOrdinals);
    this._takenPieces = new Set(this.coinPieces.map(([o, i]) => `${o}:${i}`));
    this.coins = Number.isFinite(coins) ? coins : this.coinOrdinals.length;
    this.coinPickups = this.coins;
    this.continuesUsed = continuesUsed;
    this.flightFrames = flightFrames;
    this.syncStageToScore();
    this._layPillars();
    if (shield) this.grantShield();
  }

  /** Quantos obstaculos ja foram nesta fase (0..STAGE_LENGTH). */
  get stageProgress() {
    return this.score - this.stage * STAGE_LENGTH;
  }

  /**
   * Tempo de voo desta partida, em ms: so os frames voando de fato (PLAYING).
   * A espera do primeiro toque, a pausa, os paineis e os anuncios nao entram.
   */
  get flightMs() {
    return Math.round(this.flightFrames * FIXED_DT);
  }

  /** Existe fase nova depois desta, ou daqui para frente e so repeteco? */
  get hasNextLook() {
    return this.stage + 1 < STAGE_COUNT;
  }

  /**
   * Comeca a proxima fase, mantendo o placar. As colunas voltam para fora da
   * tela e o mundo fica em READY: depois de um anuncio o dedo do jogador nao
   * esta mais na tela, entao ninguem deve morrer por causa disso.
   */
  nextStage() {
    this.stage += 1;
    this.applyStage();
    this._backToReady();
    this.powers.onStageStart(this);
  }

  /**
   * Nova chance: a partida volta do ponto em que o passaro caiu.
   *
   * Placar, fase e moedas ficam; o passaro volta ao meio da tela e a fila de
   * colunas recomeca de fora — continuar DENTRO do cano que acabou de derruba-lo
   * seria uma segunda queda garantida. O mundo fica em READY, esperando o toque,
   * como depois da troca de fase.
   *
   * Quem cobra a nova chance e o servidor: isto so executa o que ele aceitou.
   */
  revive() {
    if (this.phase !== PHASE.OVER) return false;
    this.continuesUsed += 1;
    this._clearShield();
    this._backToReady();
    this.powers.onRevive(this);
    return true;
  }

  /** Passaro no meio, colunas do lado de fora, mundo esperando o toque. */
  _backToReady() {
    const L = this.layout;
    this.phase = PHASE.READY;
    this.settled = false;
    this._hit = false;
    this.birdRotation = 0;
    this.heavyAt = 0;

    Matter.Body.setPosition(this.bird, { x: L.birdX, y: L.playHeight / 2 });
    Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
    this.birdY = L.playHeight / 2;

    this._layPillars();
    this._setHeavy(false);
  }

  /** Poe o passaro no chao, parado — para a tela de fim restaurada apos girar. */
  dropToFloor() {
    const L = this.layout;
    const floorY = L.playHeight - L.birdRadius;
    this.phase = PHASE.OVER;
    this.settled = true;
    Matter.Body.setPosition(this.bird, { x: L.birdX, y: floorY });
    Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
    this.birdY = floorY;
    this.birdRotation = 88;
  }

  /**
   * Recompensa do escudo. Ele fica inteiro ate a primeira batida; dali em
   * diante se dissipa aos poucos, perdoando tudo o que acontecer enquanto ainda
   * estiver na tela (ver `_absorbHit`).
   */
  grantShield() {
    this.shield = true;
    this.shieldLevel = 1;
    this.shieldFading = false;
    this.shieldFrames = 0;
  }

  /** Toque na tela: sobe. Retorna true se o toque foi consumido. */
  flap() {
    if (this.phase === PHASE.OVER || this.phase === PHASE.STAGE_CLEAR) return false;
    if (this.phase === PHASE.READY) this.phase = PHASE.PLAYING;
    Matter.Body.setVelocity(this.bird, { x: 0, y: this.layout.flapVelocity });
    return true;
  }

  /**
   * Partida encerrada e passaro ja no chao: nada mais muda de posicao.
   * Quem desenha usa isso para parar de empurrar valores a cada frame.
   */
  isIdle() {
    if (this.phase === PHASE.STAGE_CLEAR) return true; // congelado esperando o anuncio
    return this.phase === PHASE.OVER && this.settled;
  }

  /** Avanca exatamente um passo fixo de simulacao. */
  update() {
    const L = this.layout;
    if (this.isIdle()) return; // mundo parado: nao ha o que simular
    this.frame++;

    if (this.phase === PHASE.READY) {
      // Passaro flutuando no ar, esperando o primeiro toque.
      this.birdY = L.playHeight / 2 + Math.sin(this.frame / 16) * L.birdRadius * 0.9;
      this.birdRotation = Math.sin(this.frame / 16) * 6;
      this.wing = Math.sin(this.frame / 7);
      Matter.Body.setPosition(this.bird, { x: L.birdX, y: this.birdY });
      Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
      this.groundOffset += L.speed * 0.5;
      this.skyOffset += L.speed * 0.06;
      return;
    }

    // O passo comeca com o passaro voando? A batida pode trocar a fase no meio
    // dele, e o tempo de voo conta o passo inteiro (ver o chao, mais abaixo).
    const jogando = this.phase === PHASE.PLAYING;

    // Velocidade e vao sao da fase (ver applyStage), nao do placar. O poder
    // "mais lento" reduz a velocidade da fase atual por alguns segundos.
    if (this.phase === PHASE.PLAYING) {
      const passo = this.speed * this.speedFactor;
      for (const p of this.pillars) {
        p.x -= passo;
        p.gap = this.gap;

        // O ponto vale no instante em que o passaro EMERGE do outro lado da
        // coluna (o bico passa a borda direita dela). A regra anterior esperava
        // a coluna inteira passar pela CAUDA, o que custava 2*raio/velocidade
        // frames — cerca de 0,3 s de placar chegando atrasado.
        if (!p.scored && p.x + L.pillarWidth / 2 < L.birdX + L.birdRadius) {
          p.scored = true;
          this.score++;
          if (this.score >= this.stageTarget) {
            // Fase fechada: congela tudo e espera a tela chamar nextStage().
            this.phase = PHASE.STAGE_CLEAR;
          }
        }

        if (p.x + L.pillarWidth / 2 < 0) {
          // Recicla a coluna para depois da ultima da fila — e ela ganha o
          // proximo numero, que e o que decide a moeda dela.
          let maxX = -Infinity;
          for (const q of this.pillars) if (q.x > maxX) maxX = q.x;
          p.x = maxX + L.spacing;
          p.gapCenter = this._randomGapCenter(this.gap);
          p.scored = false;
          this._rollTrap(p);
          this._number(p);
        }

        this._updateTrap(p);
        this._updateDrift(p);
        this._syncPillar(p);
      }

      this.groundOffset += passo;
      this.skyOffset += passo * 0.12;
      this.wing = Math.sin(this.frame / 4.5);
      this._decayShield();
      this._updateHeavy();
      this.powers.onFrame(this);
      this._pullCoins();
    }

    // --- fisica ---
    Matter.Engine.update(this.engine, FIXED_DT);

    // O passaro so se move na vertical.
    if (this.bird.position.x !== L.birdX) {
      Matter.Body.setPosition(this.bird, { x: L.birdX, y: this.bird.position.y });
    }
    if (this.bird.velocity.y > L.maxFall) {
      Matter.Body.setVelocity(this.bird, { x: 0, y: L.maxFall });
    }

    // Teto: nao mata, so bloqueia (igual ao classico).
    if (this.bird.position.y < L.birdRadius) {
      Matter.Body.setPosition(this.bird, { x: L.birdX, y: L.birdRadius });
      if (this.bird.velocity.y < 0) Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
    }

    // Colisao com coluna, detectada pelo proprio matter-js. Invisivel (poder
    // do Fantasma), o passaro atravessa — e nem gasta o escudo.
    if (this._hit) {
      this._hit = false;
      if (this.phase === PHASE.PLAYING && !this.ghost) {
        if (this.shield) this._absorbHit();
        else if (!this.powers.onHit(this)) this.phase = PHASE.OVER;
      }
    }

    // Chao: como o teto, segura o passaro mas nao derruba — partida so acaba em
    // obstaculo. E o cano de baixo desce ate o chao, entao ficar parado la
    // embaixo nao escapa de nada: a proxima coluna bate.
    const floorY = L.playHeight - L.birdRadius;
    const noChao = this.bird.position.y >= floorY;
    if (noChao) {
      Matter.Body.setPosition(this.bird, { x: L.birdX, y: floorY });
      Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
      if (this.phase === PHASE.OVER) this.settled = true;
    }

    // Tempo de voo: o passo que comecou voando, fora do chao. Parado la embaixo
    // nao e voar.
    if (jogando && !noChao) this.flightFrames++;

    this.birdY = this.bird.position.y;

    // Moeda so se pega voando: nem no chao depois da queda, nem congelado.
    // O frame que fecha a fase ainda conta — a moeda estava no caminho.
    if (this.phase === PHASE.PLAYING || this.phase === PHASE.STAGE_CLEAR) {
      this._collectCoins();
    }

    const target = clamp(this.bird.velocity.y * (85 / (L.maxFall * 1.15)), -26, 88);
    this.birdRotation += (target - this.birdRotation) * 0.18;
  }

  /**
   * Coloca a fila de colunas do lado de fora da tela, prontas para entrar.
   *
   * Numera cada coluna a partir do placar: a primeira a chegar no passaro e a
   * `score + 1`, e assim por diante. Toda recolocacao da fila (partida nova,
   * fase nova, nova chance, tela girada) passa por aqui — e e isso que mantem o
   * numero da coluna igual ao placar no instante em que ela e passada.
   */
  _layPillars() {
    const L = this.layout;
    this.lastGapCenter = null;
    this.nextOrdinal = this.score + 1;
    let x = L.width + L.pillarWidth;
    for (const p of this.pillars) {
      p.x = x;
      p.gap = this.gap;
      p.gapCenter = this._randomGapCenter(this.gap);
      p.scored = false;
      this._rollTrap(p);
      this._number(p);
      this._syncPillar(p);
      x += L.spacing;
    }
  }

  /** Da a coluna o proximo numero da fila e decide a moeda dela. */
  _number(p) {
    p.ordinal = this.nextOrdinal++;
    this._rollCoin(p);
  }

  _rollCoin(p) {
    const { seed, coinEvery } = this.run;
    const letra = coinLetterAt(seed, p.ordinal, coinEvery, STAGE_LENGTH);
    if (!letra) {
      p.coin = null;
      return;
    }
    const passo = this._coinPitch;
    p.coin = {
      letter: letra,
      offset: coinOffset(seed, p.ordinal),
      pieces: LETTER_PIECES[letra].map(({ col, row }, i) => ({
        i,
        // Lugar da moeda na letra, em px a partir do centro dela.
        x: col * passo,
        y: row * passo,
        // Moeda ja pega nao volta: nem depois da nova chance, nem com a tela girada.
        taken: this._takenPieces.has(`${p.ordinal}:${i}`),
        // O quanto o ima a tirou do lugar, e se ele ja a fisgou.
        dx: 0,
        dy: 0,
        pulled: false,
      })),
    };
  }

  /**
   * Altura do centro da letra de moedas de uma coluna — acompanha o vao que
   * desliza. A letra inteira cabe no vao mesmo com o gelo saindo de qualquer um
   * dos canos, em qualquer fase; a folga que sobra e o quanto ela sobe ou desce.
   */
  letterY(p) {
    const offset = p.coin ? p.coin.offset : 0.5;
    const folga = Math.max(0, p.gap / 2 - p.gap * ICE_GAP_BITE - this._letterHalf);
    return p.gapCenter + (offset - 0.5) * 2 * folga;
  }

  /** Centro de uma moeda da letra: o lugar dela na letra, mais o que o ima puxou. */
  pieceX(p, piece) {
    return p.x + piece.x + piece.dx;
  }

  pieceY(p, piece) {
    return this.letterY(p) + piece.y + piece.dy;
  }

  /**
   * O ima: a moeda que entra no alcance voa ate o passaro. Uma vez puxada, ela
   * vem ate o fim, mesmo que o ima desligue no caminho — moeda parada no meio do
   * ar, fora do vao, nao faria sentido.
   */
  _pullCoins() {
    if (!this.run.coinEvery) return;
    const L = this.layout;
    const alcance = Math.min(this.magnetReach, L.birdRadius * MAGNET_MAX_REACH);
    const birdY = this.bird.position.y;

    for (const p of this.pillars) {
      // So de obstaculo ate o seguinte ao placar: o servidor nao aceita alem.
      if (!p.coin || p.ordinal > this.score + 1) continue;
      const cy = this.letterY(p);
      for (const piece of p.coin.pieces) {
        if (piece.taken) continue;
        const dx = L.birdX - (p.x + piece.x + piece.dx);
        const dy = birdY - (cy + piece.y + piece.dy);
        if (!piece.pulled) {
          if (alcance <= 0 || dx * dx + dy * dy > alcance * alcance) continue;
          piece.pulled = true;
        }
        piece.dx += dx * MAGNET_PULL;
        piece.dy += dy * MAGNET_PULL;
      }
    }
  }

  /**
   * O passaro esta encostando em algum obstaculo agora? O invisivel pergunta
   * antes de desligar: acabar o tempo com o passaro dentro do cano nao pode
   * virar batida.
   */
  overlapsObstacle() {
    const corpos = [];
    for (const p of this.pillars) corpos.push(p.top, p.bottom, p.topCap, p.bottomCap);
    return Matter.Query.collides(this.bird, corpos).length > 0;
  }

  /**
   * Pega as moedas em que o passaro encostou neste frame.
   *
   * Cada moeda da letra e um circulo; basta o corpo do passaro tocar nela. Guarda
   * o NUMERO do obstaculo uma vez por moeda, e nao so a contagem: e essa lista que
   * vai para o servidor, que confere quantas moedas cada letra tinha
   * (server/coins.go).
   */
  _collectCoins() {
    if (!this.run.coinEvery) return;
    const L = this.layout;
    const reach = L.birdRadius * (1 + COIN_RADIUS);
    const birdY = this.bird.position.y;

    for (const p of this.pillars) {
      if (!p.coin || p.ordinal > this.score + 1) continue;
      const cy = this.letterY(p);
      for (const piece of p.coin.pieces) {
        if (piece.taken) continue;
        const dx = p.x + piece.x + piece.dx - L.birdX;
        if (dx > reach || dx < -reach) continue;
        const dy = cy + piece.y + piece.dy - birdY;
        if (dx * dx + dy * dy > reach * reach) continue;

        piece.taken = true;
        this._takenPieces.add(`${p.ordinal}:${piece.i}`);
        this.coinPieces.push([p.ordinal, piece.i]);
        this.coinOrdinals.push(p.ordinal);
        this.coins += 1;
        this.coinPickups += 1;
        this.powers.onCoin(this, p);
      }
    }
  }

  /**
   * Uma batida chega e o escudo a engole.
   *
   * A primeira colisao NAO apaga o escudo: ela dispara a dissipacao. Enquanto
   * sobrar anel na tela (`shieldLevel > 0`) qualquer colisao seguinte tambem e
   * perdoada — a tampa, a outra coluna do mesmo par, a coluna seguinte. Sem
   * isso o passaro, que no frame seguinte ainda esta DENTRO da coluna, morreria
   * do mesmo jeito; a diferenca e que agora o perdao e visivel em vez de ser
   * uma invulnerabilidade escondida.
   */
  _absorbHit() {
    if (this.frame - this._lastAbsorbFrame >= ABSORB_COOLDOWN) {
      // Quem desenha observa este contador para soltar o estilhaco e o som.
      this.shieldHits++;
      this._lastAbsorbFrame = this.frame;
    }
    if (!this.shieldFading) {
      this.shieldFading = true;
      this.shieldFrames = SHIELD_FADE_FRAMES;
    }
  }

  /** Um frame de dissipacao: `shieldLevel` cai de 1 a 0 e o escudo acaba. */
  _decayShield() {
    if (!this.shieldFading) return;
    this.shieldFrames--;
    if (this.shieldFrames <= 0) {
      this._clearShield();
      return;
    }
    this.shieldLevel = this.shieldFrames / SHIELD_FADE_FRAMES;
  }

  /** Sem escudo nenhum: nem anel na tela, nem perdao. */
  _clearShield() {
    this.shield = false;
    this.shieldLevel = 0;
    this.shieldFading = false;
    this.shieldFrames = 0;
  }

  /**
   * Sorteia a armadilha de uma coluna que acabou de entrar na fila.
   *
   * O gelo sai de UM dos dois canos, escolhido no cara ou coroa: e o que
   * obriga o jogador a olhar para o aviso em vez de decorar o caminho.
   */
  _rollTrap(p) {
    // Toda coluna que nasce (ou e reciclada) entra na fila sem armadilha.
    p.drift = null;
    p.driftDone = false;
    p.driftGlow = 0;

    if (!this.traps.ice || Math.random() > ICE_CHANCE) {
      p.ice = null;
      return;
    }
    p.ice = {
      side: Math.random() < 0.5 ? 'top' : 'bottom',
      max: this.gap * ICE_GAP_BITE,
      out: 0, // quanto ja saiu, em px
      warn: 0, // 0..1: o quanto o cano esta piscando agora
    };
  }

  /**
   * Um frame da armadilha de gelo.
   *
   * Primeiro o cano pisca em vermelho (ICE_WARN_SECONDS de distancia), depois o
   * bloco sai (ICE_OUT_SECONDS) e o vao aperta de verdade. O aviso apaga quando
   * o gelo aparece: dali em diante o perigo esta a vista, e piscar so poluiria.
   */
  _updateTrap(p) {
    const ice = p.ice;
    if (!ice) return;

    const distance = p.x - this.layout.birdX;
    const perSecond = this.speed * 60;

    if (distance <= perSecond * ICE_OUT_SECONDS) {
      ice.warn = 0;
      if (ice.out < ice.max) {
        ice.out = Math.min(ice.max, ice.out + ice.max / ICE_GROW_FRAMES);
      }
    } else if (distance <= perSecond * ICE_WARN_SECONDS) {
      ice.warn = 0.3 + 0.4 * Math.abs(Math.sin(this.frame / 4));
    }
  }

  /**
   * Um frame do vao que se mexe.
   *
   * O par inteiro desliza na vertical mantendo o TAMANHO do vao — quem muda e o
   * centro, entao o cano de cima cresce exatamente o que o de baixo encolhe. O
   * jogador nao perde espaco; ele perde a certeza de onde a passagem vai estar.
   *
   * O movimento comeca no frame em que a coluna ENTRA na tela e termina antes
   * de ela chegar perto: a partir de `DRIFT_SAFE_SECONDS` de viagem do passaro,
   * ela para onde estiver — e o vao e valido em qualquer ponto do caminho, entao
   * parar no meio nunca cria situacao impossivel. Sao os dois lados do mesmo
   * acordo: da para VER a armadilha acontecer, e ainda sobra um segundo com a
   * coluna parada para se posicionar.
   *
   * `glow` acompanha o movimento e some junto com ele. Serve para o olho achar
   * a coluna que esta mexendo no meio de tudo o que ja se move na tela.
   */
  _updateDrift(p) {
    if (!this.traps.drift) return;
    const L = this.layout;
    const distancia = p.x - L.birdX;
    const segura = this.speed * 60 * DRIFT_SAFE_SECONDS;

    if (p.drift) {
      if (distancia <= segura) {
        p.drift = null;
        p.driftGlow = 0;
        return;
      }
      const delta = p.drift.target - p.gapCenter;
      if (Math.abs(delta) <= p.drift.speed) {
        p.gapCenter = p.drift.target;
        p.drift = null;
        p.driftGlow = 0;
      } else {
        p.gapCenter += Math.sign(delta) * p.drift.speed;
        p.driftGlow = 0.45 + 0.35 * Math.abs(Math.sin(this.frame / 5));
      }
      return;
    }

    // Janela unica: cada coluna tira a sorte uma vez so, no frame em que a
    // borda dela cruza a beirada direita da tela.
    if (p.driftDone) return;
    if (p.x - L.pillarWidth / 2 > L.width) return;
    p.driftDone = true;
    if (distancia <= segura || Math.random() >= DRIFT_CHANCE) return;

    const target = this._driftTarget(p);
    if (target === null) return;
    p.drift = { target, speed: Math.abs(target - p.gapCenter) / DRIFT_FRAMES };
    p.driftGlow = 0.8; // acende ja no primeiro frame do movimento
  }

  /**
   * Para onde o vao daquela coluna vai. O destino fica na mesma faixa util de
   * sempre (o vao nunca encosta nas bordas) e a pelo menos DRIFT_MIN_STEP da
   * faixa de distancia: deslocamento pequeno demais ninguem percebe, e ai a
   * armadilha viraria so um sorteio diferente.
   */
  _driftTarget(p) {
    const L = this.layout;
    const lo = Math.min(L.marginY + p.gap / 2, L.playHeight - L.marginY - p.gap / 2);
    const hi = Math.max(L.marginY + p.gap / 2, L.playHeight - L.marginY - p.gap / 2);
    const step = (hi - lo) * DRIFT_MIN_STEP;
    if (hi - lo < 1 || step < 1) return null;

    const acima = p.gapCenter - step;
    const abaixo = p.gapCenter + step;
    const cabeAcima = acima > lo;
    const cabeAbaixo = abaixo < hi;
    if (!cabeAcima && !cabeAbaixo) return null;

    const paraCima = cabeAcima && (!cabeAbaixo || Math.random() < 0.5);
    return paraCima ? randRange(lo, acima) : randRange(abaixo, hi);
  }

  /**
   * Um frame da gravidade aumentada.
   *
   * O ciclo tem tres tempos, e nessa ordem:
   *
   *   1. AVISO   — a seta vermelha aparece no canto por HEAVY_WARN_FRAMES.
   *                A gravidade ainda e a de sempre.
   *   2. PESO    — a seta some, a gravidade dobra e o topo da tela pisca.
   *   3. FOLGA   — tudo volta ao normal ate a proxima vez.
   *
   * O aviso existe porque a gravidade nao pertence a obstaculo nenhum: ela vale
   * para a fase inteira, e dobrar de surpresa no meio de uma passagem apertada
   * seria morte sem chance de reagir.
   */
  _updateHeavy() {
    if (!this.traps.heavy) {
      if (this.heavy || this.heavyWarn > 0) this._setHeavy(false);
      return;
    }

    if (this.heavy) {
      this.heavyFrames--;
      if (this.heavyFrames <= 0) this._setHeavy(false);
      else this.heavyPulse = 0.45 + 0.55 * Math.abs(Math.sin(this.frame / 7));
      return;
    }

    if (this.heavyWarnFrames > 0) {
      this.heavyWarnFrames--;
      if (this.heavyWarnFrames <= 0) this._setHeavy(true);
      // Pisca tambem: seta parada no canto de uma tela cheia de movimento
      // passa despercebida.
      else this.heavyWarn = 0.55 + 0.45 * Math.abs(Math.sin(this.frame / 5));
      return;
    }

    if (this.frame >= this.heavyAt) {
      this.heavyWarnFrames = HEAVY_WARN_FRAMES;
      this.heavyWarn = 1; // acende ja neste frame, sem um piscar apagado antes
    }
  }

  /**
   * Liga/desliga o peso extra. Desligar tambem apaga o aviso e ja sorteia
   * quando a proxima rodada comeca a avisar.
   */
  _setHeavy(on) {
    const L = this.layout;
    this.heavy = on;
    this.heavyPulse = on ? 1 : 0;
    this.heavyWarn = 0;
    this.heavyWarnFrames = 0;
    this.engine.gravity.scale = (L.gravity * (on ? HEAVY_MULT : 1)) / (FIXED_DT * FIXED_DT);
    if (on) this.heavyFrames = randInt(HEAVY_FRAMES);
    else this.heavyAt = (this.frame || 0) + randInt(HEAVY_INTERVAL);
  }

  /** Borda de cima do vao, ja contando o gelo que saiu do cano de cima. */
  topEdgeOf(p) {
    return p.gapCenter - p.gap / 2 + (p.ice && p.ice.side === 'top' ? p.ice.out : 0);
  }

  /** Borda de baixo do vao, ja contando o gelo do cano de baixo. */
  bottomEdgeOf(p) {
    return p.gapCenter + p.gap / 2 - (p.ice && p.ice.side === 'bottom' ? p.ice.out : 0);
  }

  /**
   * Sorteia a altura do proximo vao. O salto em relacao ao vao anterior e
   * limitado: sem isso o jogo as vezes pede um mergulho do teto ao chao entre
   * duas colunas, o que parece injusto mesmo sendo fisicamente possivel.
   */
  _randomGapCenter(gap) {
    const L = this.layout;
    const lo = Math.min(L.marginY + gap / 2, L.playHeight - L.marginY - gap / 2);
    const hi = Math.max(L.marginY + gap / 2, L.playHeight - L.marginY - gap / 2);

    if (this.lastGapCenter === null) {
      this.lastGapCenter = randRange(lo, hi);
      return this.lastGapCenter;
    }

    const step = (hi - lo) * 0.62;
    const next = randRange(
      Math.max(lo, this.lastGapCenter - step),
      Math.min(hi, this.lastGapCenter + step)
    );
    this.lastGapCenter = next;
    return next;
  }

  /**
   * Coloca os corpos da coluna no lugar: os dois canos e as duas tampas.
   *
   * O gelo nao e um corpo separado: ele empurra a borda daquele lado para
   * dentro do vao, entao a fisica ja o enxerga sem nenhum objeto novo no motor.
   * A tampa fica na ponta do CANO, e nao na do gelo — como no desenho.
   */
  _syncPillar(p) {
    const half = this.layout.playHeight / 2;
    const meiaTampa = this._capShape.height / 2;
    Matter.Body.setPosition(p.top, { x: p.x, y: this.topEdgeOf(p) - half });
    Matter.Body.setPosition(p.bottom, { x: p.x, y: this.bottomEdgeOf(p) + half });
    Matter.Body.setPosition(p.topCap, { x: p.x, y: p.gapCenter - p.gap / 2 - meiaTampa });
    Matter.Body.setPosition(p.bottomCap, { x: p.x, y: p.gapCenter + p.gap / 2 + meiaTampa });
  }
}

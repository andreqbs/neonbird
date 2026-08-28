import Matter from 'matter-js';
import { FIXED_DT, PHASE, SHIELD_FADE_FRAMES, STAGE_LENGTH } from './constants';
import { STAGE_COUNT, stageAt } from './stages';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const randRange = (a, b) => a + Math.random() * (b - a);

// Contato continuo (raspar na coluna, arrastar no chao) rende varios
// 'collisionStart' seguidos. Duas absorcoes a menos de 8 frames contam como a
// mesma batida para efeito de som e estilhaco.
const ABSORB_COOLDOWN = 8;

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
 */
export default class World {
  constructor(layout) {
    this.layout = layout;

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
      this.pillars.push({ top, bottom, x: 0, gapCenter: 0, gap: layout.gap, scored: false });
      bodies.push(top, bottom);
    }
    Matter.Composite.add(this.engine.world, bodies);

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
    this.wing = 0;
    this.lastGapCenter = null;
    this.groundOffset = 0;
    this.skyOffset = 0;
    this.birdY = L.playHeight / 2;
    this.birdRotation = 0;

    Matter.Body.setPosition(this.bird, { x: L.birdX, y: L.playHeight / 2 });
    Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });

    let x = L.width + L.pillarWidth;
    for (const p of this.pillars) {
      p.x = x;
      p.gap = L.gap;
      p.gapCenter = this._randomGapCenter(L.gap);
      p.scored = false;
      this._syncPillar(p);
      x += L.spacing;
    }
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
    this.speed = L.speed * s.speed;
    // gapMin e o piso: nenhuma fase pode apertar o vao alem do jogavel.
    this.gap = Math.max(L.gap * s.gap, L.gapMin);
    this.stageTarget = (this.stage + 1) * STAGE_LENGTH;
    for (const p of this.pillars) {
      p.gap = this.gap;
      this._syncPillar(p);
    }
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

  /** Quantos obstaculos ja foram nesta fase (0..STAGE_LENGTH). */
  get stageProgress() {
    return this.score - this.stage * STAGE_LENGTH;
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
    const L = this.layout;
    this.stage += 1;
    this.applyStage();
    this.phase = PHASE.READY;
    this.settled = false;
    this._hit = false;
    this.lastGapCenter = null;
    this.birdRotation = 0;

    Matter.Body.setPosition(this.bird, { x: L.birdX, y: L.playHeight / 2 });
    Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
    this.birdY = L.playHeight / 2;

    let x = L.width + L.pillarWidth;
    for (const p of this.pillars) {
      p.x = x;
      p.gap = this.gap;
      p.gapCenter = this._randomGapCenter(this.gap);
      p.scored = false;
      this._syncPillar(p);
      x += L.spacing;
    }
  }

  /**
   * Recompensa do anuncio premiado. O escudo fica inteiro ate a primeira
   * batida; dali em diante ele se dissipa aos poucos, perdoando tudo o que
   * acontecer enquanto ainda estiver na tela (ver `_absorbHit`).
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

    // Velocidade e vao sao da fase (ver applyStage), nao do placar.
    if (this.phase === PHASE.PLAYING) {
      for (const p of this.pillars) {
        p.x -= this.speed;
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
          // Recicla a coluna para depois da ultima da fila.
          let maxX = -Infinity;
          for (const q of this.pillars) if (q.x > maxX) maxX = q.x;
          p.x = maxX + L.spacing;
          p.gapCenter = this._randomGapCenter(this.gap);
          p.scored = false;
        }

        this._syncPillar(p);
      }

      this.groundOffset += this.speed;
      this.skyOffset += this.speed * 0.12;
      this.wing = Math.sin(this.frame / 4.5);
      this._decayShield();
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

    // Colisao com coluna, detectada pelo proprio matter-js.
    if (this._hit) {
      this._hit = false;
      if (this.phase === PHASE.PLAYING) {
        if (this.shield) this._absorbHit();
        else this.phase = PHASE.OVER;
      }
    }

    // Chao.
    const floorY = L.playHeight - L.birdRadius;
    if (this.bird.position.y >= floorY) {
      Matter.Body.setPosition(this.bird, { x: L.birdX, y: floorY });
      Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
      if (this.phase === PHASE.PLAYING) {
        if (this.shield) {
          // Escudo tambem salva do chao: absorve e devolve o passaro para o ar.
          this._absorbHit();
          Matter.Body.setVelocity(this.bird, { x: 0, y: L.flapVelocity });
        } else {
          this.phase = PHASE.OVER;
        }
      } else if (this.phase === PHASE.OVER) {
        this.settled = true;
      }
    }

    this.birdY = this.bird.position.y;

    const target = clamp(this.bird.velocity.y * (85 / (L.maxFall * 1.15)), -26, 88);
    this.birdRotation += (target - this.birdRotation) * 0.18;
  }

  /**
   * Uma batida chega e o escudo a engole.
   *
   * A primeira colisao NAO apaga o escudo: ela dispara a dissipacao. Enquanto
   * sobrar anel na tela (`shieldLevel > 0`) qualquer colisao seguinte tambem e
   * perdoada — a outra coluna do mesmo par, a coluna seguinte, o chao. Sem
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

  _syncPillar(p) {
    const half = this.layout.playHeight / 2;
    Matter.Body.setPosition(p.top, { x: p.x, y: p.gapCenter - p.gap / 2 - half });
    Matter.Body.setPosition(p.bottom, { x: p.x, y: p.gapCenter + p.gap / 2 + half });
  }
}

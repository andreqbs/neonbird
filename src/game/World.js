import Matter from 'matter-js';
import { FIXED_DT, PHASE } from './constants';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const randRange = (a, b) => a + Math.random() * (b - a);

/**
 * Mundo do jogo.
 *
 * Toda a fisica (gravidade, integracao da velocidade e deteccao de colisao)
 * roda no matter-js. O passaro e um corpo dinamico de verdade; as colunas sao
 * corpos estaticos marcados como `isSensor`, ou seja, o motor detecta o
 * contato e dispara `collisionStart`, mas nao empurra o passaro.
 *
 * A classe nao conhece React: quem desenha apenas le `birdY`, `pillars`, etc.
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
    this.speed = L.speed;
    this.gap = L.gap;
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

  /** Toque na tela: sobe. Retorna true se o toque foi consumido. */
  flap() {
    if (this.phase === PHASE.OVER) return false;
    if (this.phase === PHASE.READY) this.phase = PHASE.PLAYING;
    Matter.Body.setVelocity(this.bird, { x: 0, y: this.layout.flapVelocity });
    return true;
  }

  /**
   * Partida encerrada e passaro ja no chao: nada mais muda de posicao.
   * Quem desenha usa isso para parar de empurrar valores a cada frame.
   */
  isIdle() {
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

    // Dificuldade progressiva: acelera e fecha um pouco o vao ate 40 pontos.
    const t = Math.min(this.score / 40, 1);
    this.speed = L.speed * (1 + 0.55 * t);
    this.gap = L.gap - (L.gap - L.gapMin) * t;

    if (this.phase === PHASE.PLAYING) {
      for (const p of this.pillars) {
        p.x -= this.speed;
        p.gap = this.gap;

        if (!p.scored && p.x + L.pillarWidth / 2 < L.birdX - L.birdRadius) {
          p.scored = true;
          this.score++;
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
      if (this.phase === PHASE.PLAYING) this.phase = PHASE.OVER;
    }

    // Chao.
    const floorY = L.playHeight - L.birdRadius;
    if (this.bird.position.y >= floorY) {
      Matter.Body.setPosition(this.bird, { x: L.birdX, y: floorY });
      Matter.Body.setVelocity(this.bird, { x: 0, y: 0 });
      if (this.phase === PHASE.PLAYING) this.phase = PHASE.OVER;
      else if (this.phase === PHASE.OVER) this.settled = true;
    }

    this.birdY = this.bird.position.y;

    const target = clamp(this.bird.velocity.y * (85 / (L.maxFall * 1.15)), -26, 88);
    this.birdRotation += (target - this.birdRotation) * 0.18;
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

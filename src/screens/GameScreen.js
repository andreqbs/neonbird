import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FIXED_DT, MAX_STEPS_PER_FRAME, PHASE } from '../game/constants';
import { computeLayout } from '../game/layout';
import World from '../game/World';
import { captureSession, restoreSession } from '../game/session';
import Backdrop from '../game/render/Backdrop';
import Bird from '../game/render/Bird';
import Ground, { GROUND_TILE } from '../game/render/Ground';
import PillarPair from '../game/render/PillarPair';
import audio from '../audio/AudioManager';
import Button from '../ui/Button';
import { theme } from '../ui/theme';

const RESTART_DELAY = 650; // ms de carencia para nao reiniciar sem querer
const HINT_LINGER = 2000; // ms que o aviso "Toque para voar" ainda fica apos o toque
const HINT_FADE = 320; // ms do desaparecimento
const SCORE_BLOCK = 74; // altura ocupada pelo placar (fonte 56 + folga)

// Chute inicial da altura de cada painel, so para o primeiro frame.
const PANEL_ESTIMATE = { hint: 112, pause: 128, over: 256 };

export default function GameScreen({ onExit, best, onScore }) {
  // O jogo sempre ocupa a tela inteira (desenha ate a borda e o HUD respeita os
  // recortes), entao a janela ja e a area de jogo. `useWindowDimensions` reage
  // sozinho a rotacao, sem depender de onLayout — que nao dispara em toda
  // plataforma quando a tela nao esta sendo composta.
  const { width, height } = useWindowDimensions();

  // Girar o aparelho remonta a area de jogo com medidas novas. Este ref
  // atravessa a remontagem para a partida em andamento nao ser perdida.
  const carry = useRef({ score: 0, live: false });

  if (width < 2 || height < 2) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <GameArea
        key={`${Math.round(width)}x${Math.round(height)}`}
        width={width}
        height={height}
        onExit={onExit}
        best={best}
        onScore={onScore}
        carry={carry}
      />
    </View>
  );
}

function GameArea({ width, height, onExit, best, onScore, carry }) {
  const layout = useMemo(() => computeLayout(width, height), [width, height]);
  const insets = useSafeAreaInsets();

  // --- mundo (matter-js) ---
  const worldRef = useRef(null);
  const resumedRef = useRef(false);
  if (worldRef.current === null) {
    worldRef.current = new World(layout);
    // Veio de uma rotacao no meio da partida? Mantem o placar e devolve o
    // jogador ao estado "pronto", em vez de puni-lo por ter girado a tela.
    resumedRef.current = restoreSession(worldRef.current, carry.current);
  }
  const world = worldRef.current;

  // --- valores animados: mudam a 60fps SEM re-render do React ---
  const anim = useRef(null);
  if (anim.current === null) {
    anim.current = {
      birdY: new Animated.Value(world.birdY),
      birdRot: new Animated.Value(0),
      wing: new Animated.Value(0),
      ground: new Animated.Value(0),
      sky: new Animated.Value(0),
      pillars: world.pillars.map((p) => ({
        x: new Animated.Value(p.x),
        top: new Animated.Value(p.gapCenter - p.gap / 2),
        bottom: new Animated.Value(p.gapCenter + p.gap / 2),
      })),
    };
  }
  const a = anim.current;

  const [phase, setPhase] = useState(world.phase);
  const [score, setScore] = useState(world.score);
  const [paused, setPaused] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const hintFade = useRef(null);
  if (hintFade.current === null) hintFade.current = new Animated.Value(1);
  // Uma vez dispensado, o aviso nao volta ate a proxima partida. Sem essa
  // trava, qualquer re-render (a cada ponto marcado, por exemplo) podia
  // ressuscita-lo no meio do voo.
  const hintDoneRef = useRef(false);
  const hintTimersRef = useRef([]);

  // Altura de cada painel. Comeca numa estimativa e vira a medida real no
  // primeiro onLayout: assim o painel ja nasce na posicao certa, sem esperar
  // uma ida e volta ate o layout nativo para so entao aparecer.
  const [panelHeights, setPanelHeights] = useState(PANEL_ESTIMATE);

  const phaseRef = useRef(world.phase);
  const scoreRef = useRef(world.score);
  const pausedRef = useRef(false);
  const overAtRef = useRef(0);
  const idleRef = useRef(false);
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;

  const syncCarry = useCallback(() => {
    carry.current = captureSession(world);
  }, [carry, world]);

  const sync = useCallback(() => {
    a.birdY.setValue(world.birdY);
    a.birdRot.setValue(world.birdRotation);
    a.wing.setValue(world.wing);
    a.ground.setValue(-(world.groundOffset % GROUND_TILE));
    a.sky.setValue(-(world.skyOffset % layout.width));
    for (let i = 0; i < world.pillars.length; i++) {
      const p = world.pillars[i];
      const t = a.pillars[i];
      t.x.setValue(p.x);
      t.top.setValue(p.gapCenter - p.gap / 2);
      t.bottom.setValue(p.gapCenter + p.gap / 2);
    }
  }, [a, world, layout.width]);

  const clearHintTimers = useCallback(() => {
    for (const t of hintTimersRef.current) clearTimeout(t);
    hintTimersRef.current = [];
  }, []);

  /**
   * Dispensa o aviso "Toque para voar": ele ainda fica 2s na tela e so entao
   * se apaga. O gatilho e o proprio toque, nao a mudanca de fase — assim o
   * relogio comeca no instante do dedo, sem depender do game loop.
   *
   * Quem tira o aviso da tela e um setTimeout, e nao o callback da animacao:
   * animacao interrompida devolve `finished: false` e o aviso ficava para
   * sempre, reaparecendo no re-render do proximo ponto.
   */
  const dismissHint = useCallback(() => {
    if (hintDoneRef.current) return;
    hintDoneRef.current = true;
    hintTimersRef.current.push(
      setTimeout(() => {
        Animated.timing(hintFade.current, {
          toValue: 0,
          duration: HINT_FADE,
          // driver JS de proposito: com o nativo, um re-render (a cada ponto)
          // reaplica os props e devolve a opacidade para 1.
          useNativeDriver: false,
        }).start();
        hintTimersRef.current.push(setTimeout(() => setHintVisible(false), HINT_FADE));
      }, HINT_LINGER)
    );
  }, []);

  /** Some com o aviso agora, sem carencia (morreu ou pausou). */
  const hideHintNow = useCallback(() => {
    clearHintTimers();
    hintDoneRef.current = true;
    hintFade.current.setValue(0);
    setHintVisible(false);
  }, [clearHintTimers]);

  useEffect(() => clearHintTimers, [clearHintTimers]);

  const measurePanel = useCallback((key, height) => {
    const h = Math.round(height);
    if (h <= 0) return;
    setPanelHeights((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }));
  }, []);

  // --- game loop: passo fixo com acumulador ---
  useEffect(() => {
    let raf = 0;
    let last = null;
    let acc = 0;

    const tick = (now) => {
      raf = requestAnimationFrame(tick);

      if (last === null) {
        last = now;
        return;
      }
      let delta = now - last;
      last = now;

      if (pausedRef.current) return;
      if (delta > 200) delta = 200; // voltou do background: nao acumula divida

      acc += delta;
      let steps = 0;
      while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        world.update();
        acc -= FIXED_DT;
        steps++;
      }
      if (acc > FIXED_DT) acc = 0;
      if (steps === 0) return;

      // Depois da queda o mundo congela. Continuar empurrando ~20 valores
      // animados por frame so rouba thread de JS de quem precisa dela: o
      // painel de fim de partida. Sincroniza uma ultima vez e para.
      const idle = world.isIdle();
      if (!idle || !idleRef.current) sync();
      idleRef.current = idle;

      if (world.score !== scoreRef.current) {
        scoreRef.current = world.score;
        setScore(world.score);
        audio.playScore();
        syncCarry();
      }
      if (world.phase !== phaseRef.current) {
        phaseRef.current = world.phase;
        setPhase(world.phase);
        syncCarry();
        if (world.phase === PHASE.OVER) {
          overAtRef.current = Date.now();
          audio.playHit();
          hideHintNow();
          // Gravar o historico e falar com o Play Jogos custa disco e rede. Se
          // isso entrar na frente, o painel demora a aparecer — entao ele vai
          // para o proximo tick, depois que a tela ja mostrou o resultado.
          const finalScore = world.score;
          setTimeout(() => {
            Promise.resolve(onScoreRef.current?.(finalScore, { landscape: layout.landscape }))
              .then((newBest) => setIsNewBest(Boolean(newBest)))
              .catch(() => {});
          }, 0);
        }
      }
    };

    sync();
    syncCarry();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, sync, syncCarry, layout.landscape, hideHintNow]);

  // Pausa sozinho quando o app sai da frente.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && phaseRef.current === PHASE.PLAYING) {
        pausedRef.current = true;
        setPaused(true);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => () => world.destroy(), [world]);

  const restart = useCallback(() => {
    world.reset();
    resumedRef.current = false;
    phaseRef.current = world.phase;
    scoreRef.current = 0;
    setPhase(world.phase);
    setScore(0);
    setIsNewBest(false);
    clearHintTimers();
    hintDoneRef.current = false;
    hintFade.current.setValue(1);
    setHintVisible(true);
    syncCarry();
    sync();
  }, [world, sync, syncCarry, clearHintTimers]);

  const handleTap = useCallback(() => {
    if (pausedRef.current) return;
    if (world.phase === PHASE.OVER) {
      if (Date.now() - overAtRef.current < RESTART_DELAY) return;
      restart();
      return;
    }
    if (world.flap()) {
      // O aviso e dispensado antes do som: nada no caminho do audio pode
      // impedir que o relogio dele comece a contar.
      dismissHint();
      audio.playFlap();
    }
  }, [world, restart, dismissHint]);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  }, []);

  const hudTop = insets.top + 12;
  const hudSide = 16;

  // Em retrato o painel fica logo abaixo do placar; em paisagem falta altura,
  // entao ele vai para o centro (o proprio Overlay decide, com a altura medida).
  const panelTop = hudTop + 40 + SCORE_BLOCK + 16;

  return (
    <View style={styles.root}>
      <Backdrop layout={layout} skyOffset={a.sky} />

      {/* Area de jogo: recorta as colunas que passam do chao. */}
      <View
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          left: 0,
          top: 0,
          width: layout.width,
          height: layout.playHeight,
          overflow: 'hidden',
        }}
      >
        {a.pillars.map((t, i) => (
          <PillarPair key={i} layout={layout} x={t.x} topEdge={t.top} bottomEdge={t.bottom} />
        ))}
        <Bird layout={layout} y={a.birdY} rotation={a.birdRot} wing={a.wing} />
      </View>

      <Ground layout={layout} offset={a.ground} />

      {/* Superficie de toque: fica abaixo do HUD na ordem de render. */}
      <Pressable style={StyleSheet.absoluteFill} onPressIn={handleTap} />

      {/* ---------- HUD ---------- */}
      {phase !== PHASE.OVER && (
        <View style={[styles.scoreWrap, { pointerEvents: 'none', top: hudTop + 40 }]}>
          <Text style={styles.score}>{score}</Text>
        </View>
      )}

      <View
        style={[
          styles.topBar,
          { top: hudTop, left: insets.left + hudSide, right: insets.right + hudSide },
        ]}
      >
        <Button title="Menu" variant="ghost" compact onPress={onExit} />
        {phase === PHASE.PLAYING && (
          <Button
            title={paused ? 'Continuar' : 'Pausar'}
            variant="ghost"
            compact
            onPress={togglePause}
          />
        )}
      </View>

      {hintVisible && !paused && phase !== PHASE.OVER && (
        <Overlay
          layout={layout}
          insets={insets}
          portraitTop={panelTop}
          height={panelHeights.hint}
          onMeasure={(h) => measurePanel('hint', h)}
          pointerEvents="none"
          style={{ opacity: hintFade.current }}
        >
          <View style={styles.hintCard}>
            <Text style={styles.hintTitle}>
              {resumedRef.current ? 'Tela girada' : 'Toque para voar'}
            </Text>
            <Text style={styles.hintText}>
              {resumedRef.current
                ? `Sua partida continua de onde parou, com ${score} ponto${score === 1 ? '' : 's'}. Toque para seguir.`
                : 'Cada toque impulsiona. Sem toque, a gravidade faz o resto.'}
            </Text>
          </View>
        </Overlay>
      )}

      {paused && phase === PHASE.PLAYING && (
        <Overlay
          layout={layout}
          insets={insets}
          portraitTop={panelTop}
          height={panelHeights.pause}
          onMeasure={(h) => measurePanel('pause', h)}
        >
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Pausado</Text>
            <View style={styles.row}>
              <Button title="Continuar" onPress={togglePause} />
              <Button title="Menu" variant="ghost" onPress={onExit} style={{ marginLeft: 12 }} />
            </View>
          </View>
        </Overlay>
      )}

      {phase === PHASE.OVER && (
        <Overlay
          layout={layout}
          insets={insets}
          portraitTop={panelTop}
          height={panelHeights.over}
          onMeasure={(h) => measurePanel('over', h)}
        >
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{isNewBest ? 'Novo recorde!' : 'Voo encerrado'}</Text>

            <View style={styles.statsRow}>
              <Stat label="Pontos" value={score} highlight />
              <View style={styles.divider} />
              <Stat label="Recorde" value={Math.max(best, score)} />
            </View>

            <View style={styles.row}>
              <Button title="Jogar de novo" onPress={restart} />
              <Button title="Menu" variant="ghost" onPress={onExit} style={{ marginLeft: 12 }} />
            </View>
            <Text style={styles.tapHint}>ou toque na tela</Text>
          </View>
        </Overlay>
      )}
    </View>
  );
}

/**
 * Caixa flutuante do jogo (aviso, pausa e fim de partida).
 *
 * A posicao e calculada em pixels, nunca por `absoluteFill` + centralizacao
 * flex: no Android essa combinacao resolvia altura zero e jogava o painel para
 * o topo da tela (na web funcionava). A regra e:
 *   - paisagem: centro vertical da tela;
 *   - retrato: logo abaixo do placar, sem nunca vazar pelo rodape.
 *
 * A altura vem de fora (`height`) ja com um valor util no primeiro frame, e o
 * onLayout so refina. Esperar a medida para so entao mostrar o painel atrasava
 * a aparicao — justamente no momento em que a thread de JS esta mais ocupada.
 */
function Overlay({ layout, insets, portraitTop, height, onMeasure, pointerEvents, style, children }) {
  const minTop = insets.top + 12;
  const maxTop = Math.max(minTop, layout.height - insets.bottom - 16 - height);
  const top = layout.landscape
    ? Math.max(minTop, (layout.height - height) / 2)
    : Math.min(portraitTop, maxTop);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: insets.left,
          right: insets.right,
          top,
          alignItems: 'center',
          pointerEvents,
        },
        style,
      ]}
    >
      <View onLayout={(e) => onMeasure(e.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && { color: theme.pillar }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.skyTop, overflow: 'hidden' },
  scoreWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  score: {
    color: theme.text,
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 8,
  },
  topBar: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hintCard: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 18,
    backgroundColor: 'rgba(8,12,34,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.35)',
    maxWidth: 330,
  },
  hintTitle: {
    color: theme.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  hintText: { color: theme.textDim, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  panel: {
    paddingVertical: 24,
    paddingHorizontal: 28,
    borderRadius: 24,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.28)',
    alignItems: 'center',
    minWidth: 300,
  },
  panelTitle: { color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 16 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  stat: { alignItems: 'center', minWidth: 92 },
  statLabel: {
    color: theme.textDim,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  statValue: { color: theme.text, fontSize: 34, fontWeight: '900' },
  divider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.14)', marginHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center' },
  tapHint: { color: theme.textDim, fontSize: 12, marginTop: 12 },
});

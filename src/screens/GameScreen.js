import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FIXED_DT,
  ICE_GAP_BITE,
  MAX_STEPS_PER_FRAME,
  PHASE,
  STAGE_LENGTH,
} from '../game/constants';
import { STAGE_COUNT, stageAt, stageNumber } from '../game/stages';
import { computeLayout } from '../game/layout';
import World from '../game/World';
import { captureSession, restoreSession } from '../game/session';
import Backdrop from '../game/render/Backdrop';
import Bird from '../game/render/Bird';
import GravityWarning from '../game/render/GravityWarning';
import Ground, { GROUND_TILE } from '../game/render/Ground';
import PillarPair from '../game/render/PillarPair';
import ScoreDigits from '../game/render/ScoreDigits';
import ShieldBurst, { BURST_DURATION } from '../game/render/ShieldBurst';
import audio from '../audio/AudioManager';
import useAds from '../hooks/useAds';
import useLives from '../hooks/useLives';
import ads from '../services/ads';
import { livesNow, refillLives, spendLife } from '../services/lives';
import AdCover from '../ui/AdCover';
import Button from '../ui/Button';
import LifeBirds from '../ui/LifeBirds';
import { theme } from '../ui/theme';

const RESTART_DELAY = 650; // ms de carencia para nao reiniciar sem querer
const HINT_LINGER = 1000; // ms que o aviso "Toque para voar" ainda fica apos o toque
const HINT_FADE = 320; // ms do desaparecimento
const SCORE_FONT = 56; // tamanho do numero do placar
const PROGRESS_FONT = 10; // tamanho do contador de obstaculos da fase
const SCORE_BLOCK = 74; // altura ocupada pelo placar (fonte 56 + folga)

// Chute inicial da altura de cada painel, so para o primeiro frame.
const PANEL_ESTIMATE = { hint: 112, pause: 128, over: 300, stage: 250, win: 380 };

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
      // Quanto ainda resta do escudo (1 = inteiro, 0 = acabou). E um valor
      // animado porque cai a cada frame enquanto ele se dissipa.
      shieldLevel: new Animated.Value(world.shieldLevel),
      // Pisca do topo da tela enquanto a gravidade esta aumentada, e a seta do
      // canto nos dois segundos que vem antes dela.
      heavy: new Animated.Value(0),
      heavyWarn: new Animated.Value(0),
      pillars: world.pillars.map((p) => ({
        x: new Animated.Value(p.x),
        top: new Animated.Value(p.gapCenter - p.gap / 2),
        bottom: new Animated.Value(p.gapCenter + p.gap / 2),
        // Armadilha de gelo: quanto ja saiu de cada cano e o quanto ele pisca.
        iceTop: new Animated.Value(0),
        iceBottom: new Animated.Value(0),
        warnTop: new Animated.Value(0),
        warnBottom: new Animated.Value(0),
        // Brilho de quando o par esta deslizando na vertical.
        driftGlow: new Animated.Value(0),
        // Ultimo valor enviado de cada um dos cinco acima (ver `sync`).
        last: { iceTop: 0, iceBottom: 0, warnTop: 0, warnBottom: 0, driftGlow: 0 },
      })),
    };
  }
  const a = anim.current;

  const [phase, setPhase] = useState(world.phase);
  const [paused, setPaused] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [hintKind, setHintKind] = useState(resumedRef.current ? 'resumed' : 'start');
  const [stageIndex, setStageIndex] = useState(world.stage);
  const [shield, setShield] = useState(world.shield);
  const { adState, adSeconds, showRewarded, showRewardedOrGrant } = useAds();
  // O hook so serve para redesenhar o painel de fim de jogo quando as vidas
  // mudam; quem decide alguma coisa le livesNow(), que nunca esta atrasado.
  const { lives } = useLives();
  const [burst, setBurst] = useState(0); // chave do estilhaco; 0 = nenhum
  const hintFade = useRef(null);
  if (hintFade.current === null) hintFade.current = new Animated.Value(1);
  // Uma vez dispensado, o aviso nao volta ate a proxima partida. Sem essa
  // trava, qualquer re-render da tela podia ressuscita-lo no meio do voo.
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
  const shieldRef = useRef(world.shield);
  const shieldHitsRef = useRef(world.shieldHits);
  // O placar nao passa mais pelo render desta tela: o loop fala direto com ele.
  const scoreHudRef = useRef(null);
  const burstTimerRef = useRef(null);
  const lastHeavyRef = useRef(0);
  const lastHeavyWarnRef = useRef(0);
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
    a.shieldLevel.setValue(world.shieldLevel);
    // O pisca da gravidade e o gelo passam a maior parte do tempo parados em
    // zero. Mandar so quando mudam evita ~20 mensagens por frame para o lado
    // nativo — e e o lado nativo que precisa sobrar folga aqui.
    const heavy = world.heavyPulse || 0;
    if (heavy !== lastHeavyRef.current) {
      a.heavy.setValue(heavy);
      lastHeavyRef.current = heavy;
    }
    const warn = world.heavyWarn || 0;
    if (warn !== lastHeavyWarnRef.current) {
      a.heavyWarn.setValue(warn);
      lastHeavyWarnRef.current = warn;
    }

    for (let i = 0; i < world.pillars.length; i++) {
      const p = world.pillars[i];
      const t = a.pillars[i];
      t.x.setValue(p.x);
      // A borda do CANO, sem o gelo: o bloco tem posicao propria no desenho.
      t.top.setValue(p.gapCenter - p.gap / 2);
      t.bottom.setValue(p.gapCenter + p.gap / 2);

      const top = p.ice?.side === 'top';
      const bottom = p.ice?.side === 'bottom';
      const next = {
        iceTop: top ? p.ice.out : 0,
        iceBottom: bottom ? p.ice.out : 0,
        warnTop: top ? p.ice.warn : 0,
        warnBottom: bottom ? p.ice.warn : 0,
        driftGlow: p.driftGlow || 0,
      };
      for (const key of ['iceTop', 'iceBottom', 'warnTop', 'warnBottom', 'driftGlow']) {
        if (next[key] !== t.last[key]) {
          t[key].setValue(next[key]);
          t.last[key] = next[key];
        }
      }
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
          // driver JS de proposito: com o nativo, um re-render da tela reaplica
          // os props e devolve a opacidade para 1.
          useNativeDriver: false,
        }).start();
        hintTimersRef.current.push(setTimeout(() => setHintVisible(false), HINT_FADE));
      }, HINT_LINGER)
    );
  }, []);

  /** Traz o aviso de volta (nova partida ou fase nova) com o relogio zerado. */
  const showHint = useCallback(
    (kind) => {
      clearHintTimers();
      hintDoneRef.current = false;
      hintFade.current.setValue(1);
      setHintKind(kind);
      setHintVisible(true);
    },
    [clearHintTimers]
  );

  /** Some com o aviso agora, sem carencia (morreu ou pausou). */
  const hideHintNow = useCallback(() => {
    clearHintTimers();
    hintDoneRef.current = true;
    hintFade.current.setValue(0);
    setHintVisible(false);
  }, [clearHintTimers]);

  useEffect(() => clearHintTimers, [clearHintTimers]);

  /**
   * Dispara o estilhaco do escudo. Quem tira da tela e um setTimeout, e nao o
   * callback da animacao — mesma licao do aviso de "toque para voar".
   */
  const burstShield = useCallback(() => {
    setBurst((n) => n + 1);
    clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setBurst(0), BURST_DURATION + 80);
  }, []);

  useEffect(() => () => clearTimeout(burstTimerRef.current), []);

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

      // O placar vem antes de tudo, de proposito: o ponto vale no frame em que
      // foi feito, e qualquer trabalho na frente dele vira atraso visivel. O
      // aviso vai direto para o HUD, que se redesenha sozinho — nada aqui
      // depende de a tela inteira renderizar de novo.
      const scored = world.score !== scoreRef.current;
      if (scored) {
        scoreRef.current = world.score;
        scoreHudRef.current?.set(world.score, world.stageProgress);
        audio.playScore();
      }

      // Depois da queda o mundo congela. Continuar empurrando ~20 valores
      // animados por frame so rouba thread de JS de quem precisa dela: o
      // painel de fim de partida. Sincroniza uma ultima vez e para.
      const idle = world.isIdle();
      if (!idle || !idleRef.current) sync();
      idleRef.current = idle;

      if (scored) syncCarry(); // disco/estado: pode esperar o placar aparecer

      if (world.shield !== shieldRef.current) {
        shieldRef.current = world.shield;
        setShield(world.shield);
      }
      if (world.shieldHits !== shieldHitsRef.current) {
        shieldHitsRef.current = world.shieldHits;
        // Batida perdoada: estilhaco na tela e o som do impacto, senao ela
        // passa despercebida. O escudo NAO acaba aqui — ele comeca a se
        // dissipar, e segue valendo enquanto houver anel em volta do passaro.
        burstShield();
        audio.playHit();
      }
      if (world.phase !== phaseRef.current) {
        phaseRef.current = world.phase;
        setPhase(world.phase);
        syncCarry();
        if (world.phase === PHASE.STAGE_CLEAR) {
          // Fase fechada: o mundo ja congelou sozinho (World.isIdle). O video do
          // escudo comeca a carregar agora, senao o jogador aperta o botao e
          // fica olhando para nada.
          hideHintNow();
          ads.preloadRewarded();
        }
        if (world.phase === PHASE.OVER) {
          overAtRef.current = Date.now();
          audio.playHit();
          hideHintNow();
          // Ultima vida gasta: o painel vai oferecer o video, entao ele comeca
          // a carregar agora — anuncio que so carrega no clique faz o jogador
          // apertar o botao e nao ver nada acontecer.
          if (livesNow() <= 0) ads.preloadRewarded();
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
  }, [world, sync, syncCarry, layout.landscape, hideHintNow, burstShield]);

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
    // Sem vida nao ha partida nova: quem libera e o video premiado. A pergunta
    // vai direto ao servico — esperar o numero voltar por props ja custou uma
    // partida de graca no Android, onde o render chega bem depois do toque.
    if (livesNow() <= 0) return;
    spendLife();
    world.reset();
    resumedRef.current = false;
    phaseRef.current = world.phase;
    scoreRef.current = 0;
    setPhase(world.phase);
    scoreHudRef.current?.set(0, 0);
    setIsNewBest(false);
    setStageIndex(world.stage);
    setShield(world.shield);
    shieldRef.current = world.shield;
    shieldHitsRef.current = world.shieldHits;
    resumedRef.current = false;
    showHint('start');
    syncCarry();
    sync();
  }, [world, sync, syncCarry, showHint]);

  /**
   * Comeca a fase seguinte. Chamado depois do anuncio (assistido, pulado ou
   * indisponivel) — de propaganda o jogo nunca depende para continuar.
   */
  const advanceStage = useCallback(
    (rewarded) => {
      if (world.phase !== PHASE.STAGE_CLEAR) return;
      if (rewarded) world.grantShield();
      world.nextStage();
      phaseRef.current = world.phase;
      setPhase(world.phase);
      // Fase nova: o placar segue, o contador de obstaculos volta a zero.
      scoreHudRef.current?.set(world.score, world.stageProgress);
      setStageIndex(world.stage);
      setShield(world.shield);
      shieldRef.current = world.shield;
      shieldHitsRef.current = world.shieldHits;
      resumedRef.current = false;
      // Nada de "toque para voar" da fase 2 em diante: quem chegou ate aqui ja
      // sabe jogar. Quem diz onde o jogador esta e o selo de fase no topo.
      hideHintNow();
      syncCarry();
      sync();
    },
    [world, sync, syncCarry, hideHintNow]
  );

  /**
   * Botao "assistir": tenta o video premiado de verdade e, se ainda nao houver
   * SDK/IDs, roda a propaganda simulada — assim da para testar o fluxo inteiro
   * antes de a conta do AdMob existir. Em qualquer caminho a fase avanca.
   */
  /**
   * Botao "assistir": video PREMIADO, com o escudo como recompensa.
   *
   * Escudo e premio, nao pedagio: assistido, pulado ou indisponivel, a fase
   * avanca do mesmo jeito — so o escudo depende do video.
   *
   * O caminho de recusa ("continuar sem premio") nao mostra anuncio nenhum: vai
   * direto para a fase seguinte. Anuncio no jogador que acabou de dizer "nao
   * quero" e a maneira mais rapida de perde-lo — e ele nem escolheu ver.
   */
  const watchAd = useCallback(async () => {
    const { rewarded } = await showRewarded();
    advanceStage(rewarded);
  }, [advanceStage, showRewarded]);

  /**
   * Fim das cinco partidas: um video premiado devolve as cinco. Sem SDK, sem
   * IDs ou na web nao ha video nenhum, e ai `showOrGrant` libera assim mesmo —
   * ninguem pode ficar preso na tela de fim de jogo por causa de um anuncio que
   * nao existe.
   */
  const watchAdForLives = useCallback(async () => {
    if (await showRewardedOrGrant()) refillLives();
  }, [showRewardedOrGrant]);

  const handleTap = useCallback(() => {
    if (pausedRef.current) return;
    // Fim de fase tem botoes proprios: um toque solto aqui nao pode pular o
    // anuncio nem fazer o passaro bater asa com o mundo congelado.
    if (world.phase === PHASE.STAGE_CLEAR) return;
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

  const look = stageAt(stageIndex);
  // Tamanho do bloco de gelo desta fase: muda com o vao, e o vao so muda na
  // troca de fase — que e exatamente quando esta tela renderiza de novo. Zero
  // em fase sem gelo, e ai o desenho nem monta os blocos.
  const iceMax = world.traps.ice ? world.gap * ICE_GAP_BITE : 0;
  const nextLook = stageAt(stageIndex + 1);
  // Depois da ultima fase o cenario repete: stageAt trava no fim. A tela nao
  // deve prometer novidade que nao existe.
  const hasNewLook = nextLook !== look;
  const nextLine = hasNewLook
    ? `A seguir: ${nextLook.name} · +${Math.round((nextLook.speed - 1) * 100)}% de velocidade`
    : `A seguir: fase ${stageNumber(stageIndex) + 1} · velocidade no maximo`;
  const rewardOffered = ads.canShow('rewarded');
  // Zerou: acabou de fechar a ULTIMA fase da tabela. Da fase seguinte em diante
  // o jogo continua no ritmo da quinta, e o painel volta a ser o de sempre —
  // parabens que se repete a cada 100 obstaculos nao e parabens, e ruido.
  const zerou = stageIndex + 1 === STAGE_COUNT;

  // Duas situacoes, so. O aviso de abertura e da fase 1; o de tela girada
  // aparece em qualquer fase porque sem ele ninguem descobre que o jogo esta
  // parado esperando um toque.
  const hint =
    hintKind === 'resumed'
      ? {
          title: 'Tela girada',
          text: `Sua partida continua de onde parou, com ${world.score} ponto${world.score === 1 ? '' : 's'}. Toque para seguir.`,
        }
      : {
          title: 'Toque para voar',
          text: 'Cada toque impulsiona. Sem toque, a gravidade faz o resto.',
        };

  return (
    <View style={styles.root}>
      <Backdrop layout={layout} skyOffset={a.sky} stage={look} />

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
          <PillarPair
            key={i}
            layout={layout}
            x={t.x}
            topEdge={t.top}
            bottomEdge={t.bottom}
            stage={look}
            iceMax={iceMax}
            iceTop={t.iceTop}
            iceBottom={t.iceBottom}
            warnTop={t.warnTop}
            warnBottom={t.warnBottom}
            driftGlow={t.driftGlow}
          />
        ))}
        <Bird
          layout={layout}
          y={a.birdY}
          rotation={a.birdRot}
          wing={a.wing}
          shield={shield}
          shieldLevel={a.shieldLevel}
        />
        {burst > 0 && <ShieldBurst key={burst} layout={layout} y={a.birdY} />}
      </View>

      <Ground layout={layout} offset={a.ground} stage={look} />

      {/* Gravidade aumentada: enquanto dura, o topo da tela pisca em vermelho.
          A seta do canto (abaixo) e o que anuncia, dois segundos antes. */}
      <Animated.View
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          left: 0,
          top: 0,
          width: layout.width,
          height: Math.round(layout.height * 0.17),
          opacity: a.heavy,
        }}
      >
        <LinearGradient
          colors={['rgba(255,59,87,0.8)', 'rgba(255,59,87,0.3)', 'rgba(255,59,87,0)']}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        />
      </Animated.View>

      {/* Dois segundos antes do peso entrar, a seta avisa. Fica no canto, e nao
          sobre um cano, porque a gravidade nao e de nenhum obstaculo. */}
      <GravityWarning
        opacity={a.heavyWarn}
        style={{
          position: 'absolute',
          top: hudTop + 46,
          right: insets.right + hudSide,
        }}
      />

      {/* Superficie de toque: fica abaixo do HUD na ordem de render. */}
      <Pressable style={StyleSheet.absoluteFill} onPressIn={handleTap} />

      {/* ---------- HUD ---------- */}
      {phase !== PHASE.OVER && (
        <ScoreHud
          ref={scoreHudRef}
          world={world}
          stageLabel={`FASE ${stageNumber(stageIndex)} · ${look.name.toUpperCase()}`}
          scoreTop={hudTop + 40}
          stageTop={hudTop + 10}
        />
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
            <Text style={styles.hintTitle}>{hint.title}</Text>
            <Text style={styles.hintText}>{hint.text}</Text>
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

      {phase === PHASE.STAGE_CLEAR && (
        <Overlay
          layout={layout}
          insets={insets}
          portraitTop={panelTop}
          height={zerou ? panelHeights.win : panelHeights.stage}
          onMeasure={(h) => measurePanel(zerou ? 'win' : 'stage', h)}
        >
          <View style={styles.panel}>
            {zerou ? (
              <>
                {/* uma estrela por fase vencida */}
                <Text style={styles.winStars}>{'★'.repeat(STAGE_COUNT)}</Text>
                <Text style={styles.winTitle}>Voce zerou o Major Flyer!</Text>
                <Text style={styles.panelText}>
                  {`${STAGE_COUNT} fases, ${STAGE_LENGTH * STAGE_COUNT} obstaculos, gelo, gravidade dobrada e o vao fugindo do lugar. Nada disso te derrubou. Parabens.`}
                </Text>

                <View style={styles.statsRow}>
                  <Stat label="Obstaculos" value={world.score} highlight />
                  <View style={styles.divider} />
                  <Stat label="Recorde" value={Math.max(best, world.score)} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.panelTitle}>
                  {`Fase ${stageNumber(stageIndex)} concluida`}
                </Text>
                <Text style={styles.panelText}>{nextLine}</Text>
              </>
            )}

            <View style={styles.stageButtons}>
              {rewardOffered && (
                <Button
                  title="Assistir e ganhar escudo"
                  onPress={watchAd}
                  style={styles.stageButton}
                />
              )}
              <Button
                title={zerou ? 'Continuar voando' : 'Continuar sem prêmio'}
                variant={rewardOffered ? 'ghost' : 'primary'}
                onPress={() => advanceStage(false)}
                style={styles.stageButton}
              />
              {zerou && (
                <Button title="Menu" variant="ghost" onPress={onExit} style={styles.stageButton} />
              )}
            </View>
            <Text style={styles.tapHint}>
              {zerou
                ? 'Daqui para frente o jogo segue no ritmo da fase 5. O placar continua.'
                : rewardOffered
                  ? 'O vídeo é opcional: o escudo perdoa uma batida.'
                  : 'Anuncios entram quando o AdMob for configurado.'}
            </Text>
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
              <Stat label="Pontos" value={world.score} highlight />
              <View style={styles.divider} />
              <Stat label="Recorde" value={Math.max(best, world.score)} />
            </View>

            <View style={styles.livesRow}>
              <Text style={styles.livesLabel}>VIDAS</Text>
              <LifeBirds lives={lives} size={19} gap={7} />
            </View>

            {lives > 0 ? (
                <View style={styles.row}>
                  <Button title="Jogar de novo" onPress={restart} />
                  <Button title="Menu" variant="ghost" onPress={onExit} style={{ marginLeft: 12 }} />
                </View>
            ) : (
              <>
                <Text style={styles.outOfLives}>
                  Suas 5 vidas acabaram.
                </Text>
                <View style={styles.stageButtons}>
                  <Button
                    title="Assistir e ganhar 5 vidas"
                    onPress={watchAdForLives}
                    style={styles.stageButton}
                  />
                  <Button
                    title="Menu"
                    variant="ghost"
                    onPress={onExit}
                    style={styles.stageButton}
                  />
                </View>
              </>
            )}
          </View>
        </Overlay>
      )}

      {/* Cobertura do anuncio: por cima de tudo e engolindo os toques. */}
      <AdCover state={adState} seconds={adSeconds} />
    </View>
  );
}

/**
 * Os dois placares do topo: o numero da partida e o `x/10` da fase.
 *
 * Nenhum dos dois passa pelo React quando muda. O game loop chama `set()` no
 * mesmo frame em que o ponto vale, e os numeros sao rolos de digitos movidos
 * por `Animated` (ver [ScoreDigits](../game/render/ScoreDigits.js)) — o unico
 * caminho que chega em dia no Android com o jogo rodando.
 *
 * As props `world` e `stageLabel` valem so para o primeiro desenho e para a
 * troca de fase, que sao os momentos em que a tela renderiza de qualquer jeito.
 */
const ScoreHud = forwardRef(function ScoreHud({ world, stageLabel, scoreTop, stageTop }, ref) {
  const scoreRef = useRef(null);
  const progressRef = useRef(null);

  useImperativeHandle(
    ref,
    () => ({
      set(score, progress) {
        scoreRef.current?.set(score);
        progressRef.current?.set(Math.min(progress, STAGE_LENGTH));
      },
    }),
    []
  );

  return (
    <>
      <View style={[styles.scoreWrap, { pointerEvents: 'none', top: scoreTop }]}>
        <ScoreDigits
          ref={scoreRef}
          places={4}
          value={world.score}
          fontSize={SCORE_FONT}
          centered
          style={styles.score}
        />
      </View>

      <View style={[styles.stageWrap, { pointerEvents: 'none', top: stageTop }]}>
        <Text style={styles.stageChip} numberOfLines={1}>
          {stageLabel}
        </Text>
        <View style={styles.stageProgressRow}>
          <ScoreDigits
            ref={progressRef}
            places={String(STAGE_LENGTH).length}
            value={Math.min(world.stageProgress, STAGE_LENGTH)}
            fontSize={PROGRESS_FONT}
            style={styles.stageProgress}
          />
          <Text style={styles.stageProgress}>{`/${STAGE_LENGTH}`}</Text>
        </View>
      </View>
    </>
  );
});

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
    fontSize: SCORE_FONT,
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
  stageWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  stageChip: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  stageProgressRow: { flexDirection: 'row', alignItems: 'center' },
  stageProgress: { color: theme.textDim, fontSize: PROGRESS_FONT, letterSpacing: 1, opacity: 0.7 },
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
  winStars: {
    color: theme.bird,
    fontSize: 20,
    letterSpacing: 6,
    marginBottom: 6,
    textShadowColor: 'rgba(255,213,74,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  winTitle: {
    color: theme.bird,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 12,
    textShadowColor: 'rgba(255,213,74,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  panelText: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: -8,
    marginBottom: 18,
    maxWidth: 280,
  },
  stageButtons: { alignSelf: 'stretch', gap: 10 },
  stageButton: { alignSelf: 'stretch' },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  livesRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  livesLabel: {
    color: theme.textDim,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  outOfLives: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    maxWidth: 280,
  },
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

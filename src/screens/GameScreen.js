import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
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
import { captureSession, EMPTY_SESSION, restoreSession } from '../game/session';
import { abilityFor } from '../game/abilities';
import { DEFAULT_BIRD, lookFor } from '../game/birds';
import Backdrop from '../game/render/Backdrop';
import Bird from '../game/render/Bird';
import Coin, { CoinFace } from '../game/render/Coin';
import GravityWarning from '../game/render/GravityWarning';
import Ground, { GROUND_TILE } from '../game/render/Ground';
import PillarPair from '../game/render/PillarPair';
import ScoreDigits from '../game/render/ScoreDigits';
import ShieldBurst, { BURST_DURATION } from '../game/render/ShieldBurst';
import audio from '../audio/AudioManager';
import useAds from '../hooks/useAds';
import useEconomy from '../hooks/useEconomy';
import ads from '../services/ads';
import economy from '../services/economy';
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
const COIN_FONT = 15; // tamanho do contador de moedas da partida

// Chute inicial da altura de cada painel, so para o primeiro frame.
const PANEL_ESTIMATE = { hint: 112, pause: 128, over: 380, stage: 300, win: 420, chance: 360, busy: 110 };

/**
 * A tela do jogo.
 *
 * `initialRun` e a partida aberta no servidor (semente das moedas, limite de
 * novas chances); `training` e o voo sem servidor — sem moeda, vida, escudo,
 * nova chance nem ranking.
 */
export default function GameScreen({ onExit, best, onScore, initialRun = null, training = false }) {
  // O jogo sempre ocupa a tela inteira (desenha ate a borda e o HUD respeita os
  // recortes), entao a janela ja e a area de jogo. `useWindowDimensions` reage
  // sozinho a rotacao, sem depender de onLayout — que nao dispara em toda
  // plataforma quando a tela nao esta sendo composta.
  const { width, height } = useWindowDimensions();

  // Girar o aparelho remonta a area de jogo com medidas novas. Estes refs
  // atravessam a remontagem:
  //  - carry: o progresso do voo (placar, moedas, escudo);
  //  - runRef: a partida no servidor — qual e, se ja foi fechada, o que rendeu,
  //    e o que o servidor ja aceitou mas o mundo ainda nao aplicou;
  //  - liveArea: a area montada AGORA. Uma resposta do servidor que chega depois
  //    da virada precisa saber a quem avisar.
  const carry = useRef(EMPTY_SESSION);
  const runRef = useRef(null);
  if (runRef.current === null) {
    runRef.current = { run: initialRun, result: null, finishing: false, revivePaid: false, shieldPaid: false };
  }
  const liveArea = useRef(null);

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
        runRef={runRef}
        liveArea={liveArea}
        training={training}
      />
    </View>
  );
}

function GameArea({ width, height, onExit, best, onScore, carry, runRef, liveArea, training }) {
  const layout = useMemo(() => computeLayout(width, height), [width, height]);
  const insets = useSafeAreaInsets();
  const eco = useEconomy();
  const wallet = eco.wallet;
  const [, redraw] = useReducer((n) => n + 1, 0);

  // O passaro escolhido na loja: visual e habilidade, lidos uma vez por
  // montagem. Trocar de passaro e coisa da loja, nunca do meio do voo.
  const birdIdRef = useRef(null);
  if (birdIdRef.current === null) birdIdRef.current = (wallet && wallet.equippedBird) || DEFAULT_BIRD;
  const look = useMemo(() => lookFor(birdIdRef.current), []);

  // --- mundo (matter-js) ---
  const worldRef = useRef(null);
  const restoredRef = useRef(null);
  if (worldRef.current === null) {
    const w = new World(layout);
    w.setAbility(abilityFor(economy.birdById(birdIdRef.current)));
    w.setRun(runRef.current.run);
    // Veio de uma rotacao? Mantem o progresso (ver session.js).
    restoredRef.current = restoreSession(w, carry.current);
    if (!restoredRef.current) w.ability.onRunStart?.(w);

    // A nova chance ou o escudo podem ter sido pagos enquanto a tela girava: o
    // servidor ja aceitou, entao o mundo novo aplica.
    const rs = runRef.current;
    if (rs.revivePaid && w.phase === PHASE.OVER) {
      rs.revivePaid = false;
      w.revive();
      restoredRef.current = 'chance';
    }
    if (rs.shieldPaid) {
      rs.shieldPaid = false;
      w.grantShield();
    }
    worldRef.current = w;
  }
  const world = worldRef.current;

  // --- valores animados: mudam a 60fps SEM re-render do React ---
  const anim = useRef(null);
  if (anim.current === null) {
    anim.current = {
      birdY: new Animated.Value(world.birdY),
      birdRot: new Animated.Value(world.birdRotation),
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
      // O giro das moedas: um valor so para todas.
      coinSpin: new Animated.Value(1),
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
        // A moeda do vao: altura e se esta a vista.
        coinY: new Animated.Value(p.coin ? world.coinY(p) : 0),
        coinOn: new Animated.Value(p.coin && !p.coin.taken ? 1 : 0),
        // Ultimo valor enviado de cada um (ver `sync`).
        last: { iceTop: 0, iceBottom: 0, warnTop: 0, warnBottom: 0, driftGlow: 0, coinOn: -1, coinY: NaN },
      })),
    };
  }
  const a = anim.current;

  const [phase, setPhase] = useState(world.phase);
  const [paused, setPaused] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [hintVisible, setHintVisible] = useState(world.phase !== PHASE.OVER);
  const [hintKind, setHintKind] = useState(() => {
    if (restoredRef.current === 'live') return 'resumed';
    if (restoredRef.current === 'chance') return 'chance';
    return 'start';
  });
  const [stageIndex, setStageIndex] = useState(world.stage);
  const [shield, setShield] = useState(world.shield);
  // Qual acao esta esperando o servidor ('restart', 'chance', 'shield').
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const { adState, adSeconds, watchAdFor, canWatch } = useAds();
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
  const coinPickupsRef = useRef(world.coinPickups);
  // O placar e as moedas nao passam pelo render desta tela: o loop fala direto.
  const scoreHudRef = useRef(null);
  const coinHudRef = useRef(null);
  const burstTimerRef = useRef(null);
  const lastHeavyRef = useRef(0);
  const lastHeavyWarnRef = useRef(0);
  const lastSpinRef = useRef(1);
  const busyRef = useRef(null);
  const mountedRef = useRef(true);
  const onScoreRef = useRef(onScore);
  onScoreRef.current = onScore;
  const onRunOverRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setBusyState = useCallback((what) => {
    busyRef.current = what;
    if (mountedRef.current) setBusy(what);
  }, []);

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
    if (world.run.coinEvery) {
      const spin = 0.3 + 0.7 * Math.abs(Math.cos(world.frame / 12));
      if (spin !== lastSpinRef.current) {
        a.coinSpin.setValue(spin);
        lastSpinRef.current = spin;
      }
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

      const on = p.coin && !p.coin.taken ? 1 : 0;
      if (on !== t.last.coinOn) {
        t.coinOn.setValue(on);
        t.last.coinOn = on;
      }
      if (on) {
        const cy = world.coinY(p);
        if (cy !== t.last.coinY) {
          t.coinY.setValue(cy);
          t.last.coinY = cy;
        }
      }
    }
  }, [a, world, layout.width]);

  const clearHintTimers = useCallback(() => {
    for (const t of hintTimersRef.current) clearTimeout(t);
    hintTimersRef.current = [];
  }, []);

  /**
   * Dispensa o aviso "Toque para voar": ele ainda fica 1s na tela e so entao
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

  /** Traz o aviso de volta (nova partida ou nova chance) com o relogio zerado. */
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

  const measurePanel = useCallback((key, h) => {
    const rounded = Math.round(h);
    if (rounded <= 0) return;
    setPanelHeights((prev) => (prev[key] === rounded ? prev : { ...prev, [key]: rounded }));
  }, []);

  // ------------------------------------------------ partida no servidor

  /**
   * Da para oferecer a nova chance? So em partida do servidor, com a chance
   * ainda nao usada e ao menos um jeito de pagar: guardada, moedas ou video.
   */
  const canOfferContinue = useCallback(() => {
    const rs = runRef.current;
    if (training || !rs.run) return false;
    if (world.continuesUsed >= (rs.run.maxContinues || 0)) return false;
    const w = economy.economyNow().wallet;
    const price = economy.priceOf('continue');
    const guardadas = (w && w.continues) || 0;
    const moedas = (w && w.coins) || 0;
    return guardadas > 0 || (price !== null && moedas >= price) || ads.canShow('rewarded');
  }, [runRef, training, world]);

  /**
   * Fecha a partida: manda placar, moedas e tempo de voo ao servidor e guarda o
   * que ele creditou. O recorde local vai junto, como sempre.
   *
   * Continua valendo se a area de jogo mudar de tamanho ou sair no meio da
   * espera: o resultado fica no runRef e quem estiver montado redesenha.
   */
  const finishRun = useCallback(async () => {
    const rs = runRef.current;
    if (rs.finishing || rs.result) return;
    rs.finishing = true;
    if (mountedRef.current) setNotice(null);
    redraw();

    const score = world.score;
    const coinOrdinals = world.coinOrdinals.slice();
    const collected = world.coins;
    const flightMs = world.flightMs;

    // Historico local: vai para o proximo tick, gravar em disco nao pode
    // atrasar o painel.
    setTimeout(() => {
      Promise.resolve(onScoreRef.current?.(score, { landscape: layout.landscape }))
        .then((newBest) => {
          if (mountedRef.current) setIsNewBest(Boolean(newBest));
        })
        .catch(() => {});
    }, 0);

    let result;
    if (!rs.run) {
      result = { training: true };
    } else {
      const r = await economy.finishRun(rs.run.id, { points: score, coinOrdinals, flightMs });
      result = r.ok
        ? { coins: r.result.coins, stageBonus: r.result.stageBonus, collected }
        : {
            collected,
            error: r.offline
              ? 'Sem conexão agora. As moedas desta partida sobem quando a internet voltar, com o app aberto.'
              : r.error,
          };
    }
    rs.result = result;
    rs.finishing = false;
    liveArea.current?.redraw();
  }, [layout.landscape, liveArea, redraw, runRef, world]);

  /** O passaro caiu: oferece a nova chance, ou fecha a partida direto. */
  const onRunOver = useCallback(() => {
    const rs = runRef.current;
    if (rs.result || rs.finishing || canOfferContinue()) {
      redraw();
      return;
    }
    finishRun();
  }, [canOfferContinue, finishRun, redraw, runRef]);
  onRunOverRef.current = onRunOver;

  /** Mundo do zero para a partida `run` (null = treino). */
  const beginRun = useCallback(
    (run) => {
      runRef.current = { run, result: null, finishing: false, revivePaid: false, shieldPaid: false };
      world.setRun(run);
      world.reset();
      phaseRef.current = world.phase;
      scoreRef.current = 0;
      coinPickupsRef.current = world.coinPickups;
      setPhase(world.phase);
      scoreHudRef.current?.set(0, 0);
      coinHudRef.current?.set(0);
      setIsNewBest(false);
      setStageIndex(world.stage);
      setShield(world.shield);
      shieldRef.current = world.shield;
      shieldHitsRef.current = world.shieldHits;
      setNotice(null);
      showHint('start');
      syncCarry();
      sync();
    },
    [runRef, world, showHint, syncCarry, sync]
  );

  /** "Jogar de novo": outra partida no servidor, que custa outra vida. */
  const restart = useCallback(async () => {
    if (busyRef.current) return;
    if (training) {
      beginRun(null);
      return;
    }
    setBusyState('restart');
    setNotice(null);
    const r = await economy.startRun();
    setBusyState(null);
    if (!mountedRef.current) return;
    if (r.ok) beginRun(r.run);
    else if (r.code !== 'no_lives') {
      setNotice(r.offline ? 'Sem conexão com o servidor. Volte ao menu para treinar.' : r.error);
    }
  }, [beginRun, setBusyState, training]);

  /** Aplica a nova chance que o servidor ja aceitou. */
  const reviveNow = useCallback(() => {
    const rs = runRef.current;
    if (!rs.revivePaid) return;
    rs.revivePaid = false;
    if (!world.revive()) return;
    phaseRef.current = world.phase;
    setPhase(world.phase);
    setShield(false);
    shieldRef.current = false;
    scoreHudRef.current?.set(world.score, world.stageProgress);
    setNotice(null);
    showHint('chance');
    syncCarry();
    sync();
  }, [runRef, world, showHint, syncCarry, sync]);

  /** Aplica o escudo que o servidor ja descontou do estoque. */
  const applyShield = useCallback(() => {
    const rs = runRef.current;
    if (!rs.shieldPaid) return;
    rs.shieldPaid = false;
    world.grantShield();
    setShield(true);
    shieldRef.current = true;
    a.shieldLevel.setValue(world.shieldLevel);
    syncCarry();
  }, [a, runRef, world, syncCarry]);

  useEffect(() => {
    liveArea.current = { revive: reviveNow, applyShield, redraw };
    return () => {
      if (liveArea.current && liveArea.current.redraw === redraw) liveArea.current = null;
    };
  }, [liveArea, reviveNow, applyShield, redraw]);

  /**
   * Nova chance: 'stock' (guardada), 'coins' ou 'ad'. A de anuncio vira uma
   * guardada assim que o servidor confirma o video, e e usada na hora.
   */
  const doContinue = useCallback(
    async (method) => {
      const rs = runRef.current;
      if (!rs.run || busyRef.current) return;
      setNotice(null);
      setBusyState('chance');
      let pagamento = method;
      if (method === 'ad') {
        const ad = await watchAdFor('continue');
        if (!ad.ok) {
          setBusyState(null);
          if (ad.error && mountedRef.current) setNotice(ad.error);
          return;
        }
        pagamento = 'stock';
      }
      const r = await economy.continueRun(rs.run.id, pagamento);
      setBusyState(null);
      if (runRef.current !== rs) return;
      if (!r.ok) {
        if (mountedRef.current) setNotice(r.error);
        return;
      }
      rs.revivePaid = true;
      liveArea.current?.revive();
    },
    [liveArea, runRef, setBusyState, watchAdFor]
  );

  /** Gasta um escudo guardado. Devolve true quando o servidor aceitou. */
  const spendStoredShield = useCallback(async () => {
    const rs = runRef.current;
    if (!rs.run || busyRef.current) return false;
    setNotice(null);
    setBusyState('shield');
    const r = await economy.useShield(rs.run.id);
    setBusyState(null);
    if (runRef.current !== rs) return false;
    if (!r.ok) {
      if (mountedRef.current) setNotice(r.error);
      return false;
    }
    rs.shieldPaid = true;
    liveArea.current?.applyShield();
    return true;
  }, [liveArea, runRef, setBusyState]);

  /** Video premiado -> escudo guardado -> escudo usado. */
  const shieldFromAd = useCallback(async () => {
    if (busyRef.current) return false;
    setNotice(null);
    const ad = await watchAdFor('shield');
    if (!ad.ok) {
      if (ad.error && mountedRef.current) setNotice(ad.error);
      return false;
    }
    return spendStoredShield();
  }, [spendStoredShield, watchAdFor]);

  /**
   * Comeca a fase seguinte. Com escudo ou sem, assistindo ou nao — de anuncio o
   * jogo nunca depende para continuar.
   */
  const advanceStage = useCallback(() => {
    if (world.phase !== PHASE.STAGE_CLEAR) return;
    world.nextStage();
    phaseRef.current = world.phase;
    setPhase(world.phase);
    // Fase nova: o placar segue, o contador de obstaculos volta a zero.
    scoreHudRef.current?.set(world.score, world.stageProgress);
    setStageIndex(world.stage);
    setShield(world.shield);
    shieldRef.current = world.shield;
    shieldHitsRef.current = world.shieldHits;
    setNotice(null);
    // Nada de "toque para voar" da fase 2 em diante: quem chegou ate aqui ja
    // sabe jogar. Quem diz onde o jogador esta e o selo de fase no topo.
    hideHintNow();
    syncCarry();
    sync();
  }, [world, sync, syncCarry, hideHintNow]);

  const stageWithStoredShield = useCallback(async () => {
    if (await spendStoredShield()) advanceStage();
  }, [advanceStage, spendStoredShield]);

  const stageWithAdShield = useCallback(async () => {
    if (await shieldFromAd()) advanceStage();
  }, [advanceStage, shieldFromAd]);

  /** Sem vidas: o video premiado devolve as cinco, registradas no servidor. */
  const watchAdForLives = useCallback(async () => {
    setNotice(null);
    const r = await watchAdFor('lives');
    if (!r.ok && r.error && mountedRef.current) setNotice(r.error);
  }, [watchAdFor]);

  /** Sair para o menu. Partida aberta e encerrada: o que rendeu ate aqui vale. */
  const leave = useCallback(() => {
    const rs = runRef.current;
    if (rs.run && !rs.result && !rs.finishing) finishRun();
    onExit();
  }, [finishRun, onExit, runRef]);

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

      const pegou = world.coinPickups !== coinPickupsRef.current;
      if (pegou) {
        coinPickupsRef.current = world.coinPickups;
        coinHudRef.current?.set(world.coins);
        audio.playCoin();
      }

      // Depois da queda o mundo congela. Continuar empurrando ~20 valores
      // animados por frame so rouba thread de JS de quem precisa dela: o
      // painel de fim de partida. Sincroniza uma ultima vez e para.
      const idle = world.isIdle();
      if (!idle || !idleRef.current) sync();
      idleRef.current = idle;

      if (scored || pegou) syncCarry(); // estado: pode esperar o placar aparecer

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
          // A oferta da nova chance (ou das vidas) pode precisar do video.
          ads.preloadRewarded();
          onRunOverRef.current?.();
        }
      }
    };

    sync();
    syncCarry();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, sync, syncCarry, hideHintNow, burstShield]);

  // Voltou de uma rotacao ja derrubado: decide o painel (oferta ou resultado).
  useEffect(() => {
    if (world.phase === PHASE.OVER) onRunOverRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleTap = useCallback(() => {
    if (pausedRef.current || busyRef.current) return;
    // Fim de fase e oferta de nova chance tem botoes proprios: um toque solto
    // aqui nao pode decidir por ninguem.
    if (world.phase === PHASE.STAGE_CLEAR) return;
    if (world.phase === PHASE.OVER) {
      const rs = runRef.current;
      if (!rs.result) return;
      if (Date.now() - overAtRef.current < RESTART_DELAY) return;
      const w = economy.economyNow().wallet;
      if (!training && (!w || w.lives <= 0)) return;
      restart();
      return;
    }
    if (world.flap()) {
      // O aviso e dispensado antes do som: nada no caminho do audio pode
      // impedir que o relogio dele comece a contar.
      dismissHint();
      audio.playFlap();
    }
  }, [world, runRef, restart, dismissHint, training]);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  }, []);

  // ------------------------------------------------------------------ render

  const hudTop = insets.top + 12;
  const hudSide = 16;

  // Em retrato o painel fica logo abaixo do placar; em paisagem falta altura,
  // entao ele vai para o centro (o proprio Overlay decide, com a altura medida).
  const panelTop = hudTop + 40 + SCORE_BLOCK + 16;

  const rs = runRef.current;
  const online = !training && Boolean(rs.run);
  const coinsInWallet = wallet ? wallet.coins : 0;
  const shieldsInStock = online && wallet ? wallet.shields : 0;
  const continuesInStock = online && wallet ? wallet.continues : 0;
  const continuePrice = economy.priceOf('continue');
  const lives = wallet ? wallet.lives : 0;
  const maxLives = wallet ? wallet.maxLives : 5;

  const look_ = stageAt(stageIndex);
  // Tamanho do bloco de gelo desta fase: muda com o vao, e o vao so muda na
  // troca de fase — que e exatamente quando esta tela renderiza de novo. Zero
  // em fase sem gelo, e ai o desenho nem monta os blocos.
  const iceMax = world.traps.ice ? world.gap * ICE_GAP_BITE : 0;
  const nextLook = stageAt(stageIndex + 1);
  // Depois da ultima fase o cenario repete: stageAt trava no fim. A tela nao
  // deve prometer novidade que nao existe.
  const hasNewLook = nextLook !== look_;
  const nextLine = hasNewLook
    ? `A seguir: ${nextLook.name} · +${Math.round((nextLook.speed - 1) * 100)}% de velocidade`
    : `A seguir: fase ${stageNumber(stageIndex) + 1} · velocidade no maximo`;
  // Zerou: acabou de fechar a ULTIMA fase da tabela. Da fase seguinte em diante
  // o jogo continua no ritmo da quinta, e o painel volta a ser o de sempre —
  // parabens que se repete a cada 100 obstaculos nao e parabens, e ruido.
  const zerou = stageIndex + 1 === STAGE_COUNT;

  let overMode = null;
  if (phase === PHASE.OVER) overMode = rs.result ? 'result' : rs.finishing ? 'finishing' : 'chance';
  const overKey = overMode === 'chance' ? 'chance' : overMode === 'finishing' ? 'busy' : 'over';

  const chanceOptions = [];
  if (overMode === 'chance') {
    if (continuesInStock > 0) {
      chanceOptions.push({ key: 'stock', title: `Usar nova chance (${continuesInStock})` });
    }
    if (online && continuePrice !== null && coinsInWallet >= continuePrice) {
      chanceOptions.push({ key: 'coins', title: `Continuar por ${continuePrice} moedas` });
    }
    if (online && canWatch) chanceOptions.push({ key: 'ad', title: 'Assistir e continuar' });
  }

  const result = rs.result;
  const showShieldOffer =
    online && phase === PHASE.READY && !shield && shieldsInStock > 0 && !paused;
  const shieldOfferTop = layout.landscape
    ? layout.playHeight - 58
    : panelTop + (hintVisible ? panelHeights.hint + 14 : 0);

  const s = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  let hint;
  if (hintKind === 'resumed') {
    hint = {
      title: 'Tela girada',
      text: `Sua partida continua de onde parou, com ${s(world.score, 'ponto', 'pontos')}. Toque para seguir.`,
    };
  } else if (hintKind === 'chance') {
    hint = {
      title: 'Nova chance!',
      text: `Você volta com ${s(world.score, 'ponto', 'pontos')}${world.coins ? ` e ${s(world.coins, 'moeda', 'moedas')}` : ''}. Toque para voar.`,
    };
  } else if (training) {
    hint = {
      title: 'Treino',
      text: 'Sem internet: dá para voar, mas sem moedas, vidas ou ranking.',
    };
  } else {
    hint = {
      title: 'Toque para voar',
      text: 'Cada toque impulsiona. Passe pelas moedas no meio dos vãos.',
    };
  }

  return (
    <View style={styles.root}>
      <Backdrop layout={layout} skyOffset={a.sky} stage={look_} />

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
            stage={look_}
            iceMax={iceMax}
            iceTop={t.iceTop}
            iceBottom={t.iceBottom}
            warnTop={t.warnTop}
            warnBottom={t.warnBottom}
            driftGlow={t.driftGlow}
          />
        ))}
        {!training &&
          a.pillars.map((t, i) => (
            <Coin
              key={`moeda-${i}`}
              layout={layout}
              x={t.x}
              y={t.coinY}
              visible={t.coinOn}
              spin={a.coinSpin}
            />
          ))}
        <Bird
          layout={layout}
          y={a.birdY}
          rotation={a.birdRot}
          wing={a.wing}
          shield={shield}
          shieldLevel={a.shieldLevel}
          look={look}
        />
        {burst > 0 && <ShieldBurst key={burst} layout={layout} y={a.birdY} />}
      </View>

      <Ground layout={layout} offset={a.ground} stage={look_} />

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
          stageLabel={`${training ? 'TREINO · ' : ''}FASE ${stageNumber(stageIndex)} · ${look_.name.toUpperCase()}`}
          scoreTop={hudTop + 40}
          stageTop={hudTop + 10}
        />
      )}

      {!training && phase !== PHASE.OVER && (
        <CoinHud ref={coinHudRef} value={world.coins} top={hudTop + 50} left={insets.left + hudSide} />
      )}

      <View
        style={[
          styles.topBar,
          { top: hudTop, left: insets.left + hudSide, right: insets.right + hudSide },
        ]}
      >
        <Button title="Menu" variant="ghost" compact onPress={leave} />
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

      {/* Escudo guardado: oferecido antes do primeiro toque de cada fase. O
          resto da tela continua sendo a superficie de toque. */}
      {showShieldOffer && (
        <View style={[styles.shieldOffer, { top: shieldOfferTop, left: insets.left, right: insets.right }]}>
          <Pressable
            onPress={spendStoredShield}
            style={({ pressed }) => [styles.shieldChip, pressed && { opacity: 0.75 }]}
          >
            {busy === 'shield' ? (
              <ActivityIndicator size="small" color={theme.shield} />
            ) : (
              <View style={styles.shieldRing} />
            )}
            <Text style={styles.shieldChipText}>{`Usar escudo (${shieldsInStock})`}</Text>
          </Pressable>
          {notice ? <Text style={styles.readyNotice}>{notice}</Text> : null}
        </View>
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
              <Button title="Menu" variant="ghost" onPress={leave} style={{ marginLeft: 12 }} />
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
              {shieldsInStock > 0 && (
                <Button
                  title={`Usar escudo (${shieldsInStock})`}
                  onPress={stageWithStoredShield}
                  style={styles.stageButton}
                />
              )}
              {online && canWatch && (
                <Button
                  title="Assistir e ganhar escudo"
                  variant={shieldsInStock > 0 ? 'ghost' : 'primary'}
                  onPress={stageWithAdShield}
                  style={styles.stageButton}
                />
              )}
              <Button
                title={zerou ? 'Continuar voando' : online ? 'Continuar sem escudo' : 'Continuar'}
                variant={online && (shieldsInStock > 0 || canWatch) ? 'ghost' : 'primary'}
                onPress={advanceStage}
                style={styles.stageButton}
              />
              {zerou && (
                <Button title="Menu" variant="ghost" onPress={leave} style={styles.stageButton} />
              )}
            </View>
            {busy === 'shield' ? <ActivityIndicator color={theme.shield} style={{ marginTop: 12 }} /> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            <Text style={styles.tapHint}>
              {zerou
                ? 'Daqui para frente o jogo segue no ritmo da fase 5. O placar continua.'
                : online
                  ? 'O escudo perdoa as batidas enquanto se dissipa.'
                  : 'No treino não há escudo.'}
            </Text>
          </View>
        </Overlay>
      )}

      {phase === PHASE.OVER && (
        <Overlay
          layout={layout}
          insets={insets}
          portraitTop={panelTop}
          height={panelHeights[overKey]}
          onMeasure={(h) => measurePanel(overKey, h)}
        >
          {overMode === 'chance' ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Continuar daqui?</Text>
              <Text style={styles.panelText}>
                {`Você caiu com ${s(world.score, 'ponto', 'pontos')}${world.coins ? ` e ${s(world.coins, 'moeda', 'moedas')}` : ''}. A nova chance volta deste ponto — uma por partida.`}
              </Text>
              <View style={styles.stageButtons}>
                {chanceOptions.map((opt, i) => (
                  <Button
                    key={opt.key}
                    title={opt.title}
                    variant={i === 0 ? 'primary' : 'ghost'}
                    onPress={() => doContinue(opt.key)}
                    style={styles.stageButton}
                  />
                ))}
                <Button title="Encerrar voo" variant="ghost" onPress={finishRun} style={styles.stageButton} />
              </View>
              {busy === 'chance' ? <ActivityIndicator color={theme.pillar} style={{ marginTop: 12 }} /> : null}
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            </View>
          ) : overMode === 'finishing' ? (
            <View style={styles.panel}>
              <ActivityIndicator color={theme.pillar} />
              <Text style={styles.busyText}>Guardando seu voo...</Text>
            </View>
          ) : (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>
                {training ? 'Treino encerrado' : isNewBest ? 'Novo recorde!' : 'Voo encerrado'}
              </Text>

              <View style={styles.statsRow}>
                <Stat label="Pontos" value={world.score} highlight />
                <View style={styles.divider} />
                <Stat label="Recorde" value={Math.max(best, world.score)} />
              </View>

              {training || !result ? (
                <Text style={styles.panelText}>No treino não há moedas, vidas nem ranking.</Text>
              ) : result.error ? (
                <Text style={styles.notice}>{result.error}</Text>
              ) : (
                <View style={styles.earn}>
                  <View style={styles.earnRow}>
                    <CoinFace size={20} />
                    <Text style={styles.earnText}>{`+${result.coins + result.stageBonus} moedas`}</Text>
                  </View>
                  {result.stageBonus > 0 ? (
                    <Text style={styles.earnDim}>
                      {`${result.coins} no voo + ${result.stageBonus} de fase fechada`}
                    </Text>
                  ) : null}
                  {result.coins < result.collected ? (
                    <Text style={styles.earnDim}>Algumas moedas não foram aceitas pelo servidor.</Text>
                  ) : null}
                </View>
              )}

              {!training && (
                <View style={styles.livesRow}>
                  <Text style={styles.livesLabel}>VIDAS</Text>
                  <LifeBirds lives={lives} total={maxLives} size={19} gap={7} />
                </View>
              )}

              {training || lives > 0 ? (
                <View style={styles.row}>
                  <Button
                    title={busy === 'restart' ? 'Preparando...' : training ? 'Treinar de novo' : 'Jogar de novo'}
                    onPress={restart}
                  />
                  <Button title="Menu" variant="ghost" onPress={leave} style={{ marginLeft: 12 }} />
                </View>
              ) : (
                <>
                  <Text style={styles.outOfLives}>Suas vidas acabaram.</Text>
                  <View style={styles.stageButtons}>
                    {canWatch && (
                      <Button
                        title="Assistir e ganhar 5 vidas"
                        onPress={watchAdForLives}
                        style={styles.stageButton}
                      />
                    )}
                    <Button title="Menu" variant="ghost" onPress={leave} style={styles.stageButton} />
                  </View>
                </>
              )}
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            </View>
          )}
        </Overlay>
      )}

      {/* Cobertura do anuncio: por cima de tudo e engolindo os toques. */}
      <AdCover state={adState} seconds={adSeconds} />
    </View>
  );
}

/**
 * Os dois placares do topo: o numero da partida e o `x/100` da fase.
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
 * As moedas pegas nesta partida, no canto. Mesmo rolo de digitos do placar:
 * a moeda conta no frame em que foi pega, sem esperar o React.
 */
const CoinHud = forwardRef(function CoinHud({ value, top, left }, ref) {
  const digitsRef = useRef(null);
  useImperativeHandle(
    ref,
    () => ({
      set(n) {
        digitsRef.current?.set(n);
      },
    }),
    []
  );

  return (
    <View style={[styles.coinHud, { pointerEvents: 'none', top, left }]}>
      <CoinFace size={18} />
      <ScoreDigits ref={digitsRef} places={3} value={value} fontSize={COIN_FONT} style={styles.coinHudText} />
    </View>
  );
});

/**
 * Caixa flutuante do jogo (aviso, pausa, fim de fase e fim de partida).
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
  coinHud: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingLeft: 6,
    paddingRight: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(8,12,34,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,213,74,0.35)',
  },
  coinHudText: { color: theme.bird, fontSize: COIN_FONT, fontWeight: '900' },
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
  shieldOffer: { position: 'absolute', alignItems: 'center', pointerEvents: 'box-none' },
  shieldChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(8,12,34,0.72)',
    borderWidth: 1.5,
    borderColor: theme.shield,
  },
  shieldRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: theme.shield,
  },
  shieldChipText: { color: theme.text, fontSize: 14, fontWeight: '800' },
  readyNotice: {
    color: theme.danger,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 300,
  },
  panel: {
    paddingVertical: 24,
    paddingHorizontal: 28,
    borderRadius: 24,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.28)',
    alignItems: 'center',
    minWidth: 300,
    maxWidth: 360,
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
  notice: {
    color: theme.danger,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 290,
  },
  busyText: { color: theme.textDim, fontSize: 13, marginTop: 12 },
  earn: { alignItems: 'center', marginBottom: 16, gap: 4 },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  earnText: { color: theme.bird, fontSize: 20, fontWeight: '900' },
  earnDim: { color: theme.textDim, fontSize: 12, textAlign: 'center' },
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
  tapHint: { color: theme.textDim, fontSize: 12, marginTop: 12, textAlign: 'center' },
});

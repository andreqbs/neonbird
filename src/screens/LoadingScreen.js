import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BIRD_LOOKS, lookFor } from '../game/birds';
import BirdFigure from '../game/render/BirdFigure';
import { t } from '../i18n';
import economy from '../services/economy';
import { playerLoaded, subscribePlayer } from '../services/identity';
import { bootFinished, bootProgress, bootStep } from '../ui/bootProgress';
import { SKY_GRADIENT, theme } from '../ui/theme';

// Na web nao ha driver nativo de animacao: la o Animated roda no JavaScript.
const NATIVE = Platform.OS !== 'web';

/** De quanto em quanto tempo o relogio da abertura anda (e a barra com ele). */
const TICK_MS = 150;

/** O diametro do corpo do passaro que voa na barra. */
const BIRD = 30;

/**
 * A tela de carregamento da abertura: o ceu da Home, a marca e um passaro do
 * bando voando na ponta de uma barra de progresso.
 *
 * Ela fica NA FRENTE da Home, que monta por tras desde o primeiro instante — e
 * so sai quando a Home esta pronta de verdade: preferencias lidas, jogador no
 * aparelho, carteira do servidor em maos (ou a certeza de que nao ha servidor:
 * ai a Home abre no modo treino) e a propria Home medida e desenhada. Quando
 * ela some, o menu inteiro ja esta la.
 *
 * E nunca prende ninguem: a espera tem teto (BOOT_MAX_MS, bootProgress.js).
 * Passou dele, a Home abre de qualquer jeito, com "Conectando..." no botao, e
 * a resposta do servidor continua sendo esperada la.
 *
 * As medidas da cobertura sao explicitas em vez de `absoluteFill`, pelo mesmo
 * motivo da AdCover: no Android o par top/bottom resolvia altura zero.
 */
export default function LoadingScreen({ settingsLoaded, homeReady, onDone }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Um passaro do bando a cada abertura.
  const [look] = useState(() => {
    const ids = Object.keys(BIRD_LOOKS);
    return lookFor(ids[Math.floor(Math.random() * ids.length)]);
  });

  // O jogador e a economia moram fora do React: a tela so assina.
  const [player, setPlayer] = useState(playerLoaded);
  const [eco, setEco] = useState(economy.economyNow);
  useEffect(() => {
    const offPlayer = subscribePlayer((_, loaded) => setPlayer(loaded));
    const offEco = economy.subscribeEconomy(setEco);
    setPlayer(playerLoaded());
    setEco(economy.economyNow());
    // A Home tambem pede; pedidos repetidos esperam a mesma resposta.
    if (economy.economyNow().status === 'idle') economy.refresh();
    return () => {
      offPlayer();
      offEco();
    };
  }, []);

  const [saindo, setSaindo] = useState(false);

  // O relogio da abertura. Para quando a tela comeca a sair.
  const inicio = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (saindo) return undefined;
    const id = setInterval(() => setElapsed(Date.now() - inicio.current), TICK_MS);
    return () => clearInterval(id);
  }, [saindo]);

  const done = {
    settings: Boolean(settingsLoaded),
    player: Boolean(player),
    server: eco.status === 'ready' || eco.status === 'offline',
    offline: eco.status === 'offline',
    home: Boolean(homeReady),
  };
  const passo = bootStep(done, elapsed);
  const texto = t(`boot.${passo}`);
  const acabou = bootFinished(done, elapsed);

  // A barra: um so valor anima o preenchimento e o passaro, os dois no driver
  // nativo. Ela so anda para a frente — trocar de idioma monta a Home de novo,
  // e o passo "home" desmarca por um instante.
  const progresso = useRef(new Animated.Value(0)).current;
  const alcancado = useRef(0);
  const alvo = bootProgress(done, elapsed);
  useEffect(() => {
    if (saindo || alvo <= alcancado.current) return;
    alcancado.current = alvo;
    Animated.timing(progresso, {
      toValue: alvo,
      duration: TICK_MS + 100,
      easing: Easing.linear,
      useNativeDriver: NATIVE,
    }).start();
  }, [alvo, saindo, progresso]);

  // O voo: asa batendo e o corpo subindo e descendo, em laco.
  const asa = useRef(new Animated.Value(0)).current;
  const onda = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const vaiEVolta = (valor, ms, easing) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(valor, { toValue: 1, duration: ms, easing, useNativeDriver: NATIVE }),
          Animated.timing(valor, { toValue: 0, duration: ms, easing, useNativeDriver: NATIVE }),
        ])
      );
    const batida = vaiEVolta(asa, 140, Easing.inOut(Easing.quad));
    const sobeDesce = vaiEVolta(onda, 650, Easing.inOut(Easing.sin));
    batida.start();
    sobeDesce.start();
    return () => {
      batida.stop();
      sobeDesce.stop();
    };
  }, [asa, onda]);

  useEffect(() => {
    if (acabou) setSaindo(true);
  }, [acabou]);

  // A saida: a barra completa, um respiro e a cobertura some, deixando a Home.
  const opacidade = useRef(new Animated.Value(1)).current;
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (!saindo) return undefined;
    let avisou = false;
    const fecha = () => {
      if (avisou) return;
      avisou = true;
      onDoneRef.current();
    };
    alcancado.current = 1;
    Animated.sequence([
      Animated.timing(progresso, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: NATIVE,
      }),
      Animated.delay(120),
      Animated.timing(opacidade, { toValue: 0, duration: 260, useNativeDriver: NATIVE }),
    ]).start(fecha);
    // Se o fim da animacao nao avisar (app em segundo plano, por exemplo), a
    // tela sai assim mesmo.
    const id = setTimeout(fecha, 1200);
    return () => clearTimeout(id);
  }, [saindo, progresso, opacidade]);

  const util = width - insets.left - insets.right;
  const trilho = Math.max(160, Math.min(300, util - 72));
  const logo = Math.min(132, height * 0.17);
  const titulo = Math.min(32, (util - 48) / 8.6);
  const caixa = BIRD * 1.84; // corpo + a folga das pecas que saem dele (BirdFigure)

  // A tela redesenha a cada tique do relogio. Interpolacao nova a cada desenho
  // faria o Animated religar os nos nativos o tempo todo; com as mesmas, ele
  // reaproveita tudo e a animacao segue sozinha no driver nativo.
  const xPassaro = useMemo(
    () => progresso.interpolate({ inputRange: [0, 1], outputRange: [0, trilho] }),
    [progresso, trilho]
  );
  const xBarra = useMemo(
    () => progresso.interpolate({ inputRange: [0, 1], outputRange: [-trilho, 0] }),
    [progresso, trilho]
  );

  return (
    <Animated.View
      aria-modal
      style={[
        styles.cover,
        { width, height, opacity: opacidade, pointerEvents: saindo ? 'none' : 'auto' },
      ]}
    >
      <LinearGradient colors={SKY_GRADIENT} locations={[0, 0.3, 0.56, 0.8, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.vignette} />

      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* A mesma arte do icone, do splash e da Home. */}
        <Image
          source={require('../../assets/splash-icon.png')}
          style={{ width: logo, height: logo, marginBottom: -logo * 0.1 }}
          resizeMode="contain"
        />
        <Text style={[styles.title, { fontSize: titulo, letterSpacing: titulo / 9, textShadowRadius: titulo / 2 }]}>
          MAJOR FLYER
        </Text>

        <View style={{ width: trilho, marginTop: 40 }}>
          {/* O passaro voa com o centro na ponta da barra. */}
          <View style={{ height: caixa, marginBottom: -4 }}>
            <Animated.View
              style={{
                position: 'absolute',
                left: -caixa / 2,
                top: 0,
                transform: [{ translateX: xPassaro }],
              }}
            >
              <FlyingBird look={look} size={BIRD} asa={asa} onda={onda} />
            </Animated.View>
          </View>

          <View
            accessible
            role="progressbar"
            aria-label={texto}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={saindo ? 100 : Math.round(alvo * 100)}
            style={styles.track}
          >
            <Animated.View
              style={[styles.fill, { width: trilho, transform: [{ translateX: xBarra }] }]}
            >
              <View style={styles.fillShine} />
            </Animated.View>
          </View>

          <Text style={styles.label} numberOfLines={2}>
            {texto}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * O passaro em voo: o mesmo desenho da loja e da partida (BirdFigure), com a
 * asa batendo e o corpo subindo e descendo — de bico para cima na subida, para
 * baixo na descida, como no jogo.
 *
 * `memo`: as props nao mudam, entao o tique do relogio da tela nao chega aqui —
 * o voo inteiro roda no driver nativo, sem passar pelo JavaScript.
 */
const FlyingBird = React.memo(function FlyingBird({ look, size, asa, onda }) {
  const s = size;
  const pad = s * 0.42;
  const box = s + pad * 2;
  const { wingRotate, translateY, rotate } = useMemo(
    () => ({
      wingRotate: asa.interpolate({ inputRange: [0, 1], outputRange: ['-34deg', '26deg'] }),
      translateY: onda.interpolate({ inputRange: [0, 1], outputRange: [-s * 0.18, s * 0.18] }),
      rotate: onda.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '8deg'] }),
    }),
    [asa, onda, s]
  );

  return (
    <Animated.View style={{ width: box, height: box, transform: [{ translateY }, { rotate }] }}>
      <View
        style={{
          position: 'absolute',
          left: box * 0.08,
          top: box * 0.08,
          width: box * 0.84,
          height: box * 0.84,
          borderRadius: box * 0.42,
          backgroundColor: look.glow,
          opacity: 0.18,
        }}
      />
      <View style={{ position: 'absolute', left: pad, top: pad, width: s, height: s }}>
        <BirdFigure s={s} look={look} wingRotate={wingRotate} />
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 10,
    backgroundColor: theme.skyTop,
  },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,9,26,0.45)' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  title: {
    color: theme.text,
    fontWeight: '900',
    textShadowColor: 'rgba(46,230,197,0.55)',
    textShadowOffset: { width: 0, height: 0 },
  },

  track: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  fill: { height: '100%', borderRadius: 6, backgroundColor: theme.pillar },
  fillShine: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },

  label: {
    color: theme.textDim,
    fontSize: 13,
    lineHeight: 18,
    minHeight: 36,
    textAlign: 'center',
    marginTop: 16,
  },
});

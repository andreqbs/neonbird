import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoinFace } from '../game/render/Coin';
import useAds from '../hooks/useAds';
import useEconomy from '../hooks/useEconomy';
import useFitScale from '../hooks/useFitScale';
import { getLanguage, t } from '../i18n';
import economy from '../services/economy';
import AdCover from '../ui/AdCover';
import { formatFlightTime } from '../ui/flightTime';
import LifeBirds from '../ui/LifeBirds';
import { SKY_GRADIENT, theme } from '../ui/theme';

export default function HomeScreen({ onNavigate, onPlay, onTrain, best }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const eco = useEconomy();
  const { adState, adSeconds, watchAdFor, canWatch } = useAds();
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState(null);

  // A Home aparece depois de cada partida, da loja e do ranking: sempre que ela
  // monta, a carteira vem de novo do servidor. O que esta na tela e sempre o
  // que o servidor disse por ultimo.
  useEffect(() => {
    economy.refresh();
  }, []);

  // Em paisagem sobra largura e falta altura: marca de um lado, menu do outro.
  // No celular o app fica em retrato; paisagem so aparece na web.
  const side = width > height;

  // A Home nunca rola: ela cabe em qualquer tela. A altura que sobra de fato
  // (tirando barra de status, barra de navegacao e a margem) vai para o
  // useFitScale, que mede o conteudo e devolve a escala — fontes, arte e
  // espacos encolhem juntos ate caber. Num celular grande fica tudo no tamanho
  // de projeto (escala 1); num pequeno, tudo proporcionalmente menor.
  const margem = side ? 12 : 16;
  const disponivel = height - insets.top - insets.bottom - margem * 2;

  const wallet = eco.wallet;
  const ready = eco.status === 'ready' && Boolean(wallet);
  const offline = eco.status === 'offline';
  const lives = wallet ? wallet.lives : 0;
  const maxLives = wallet ? wallet.maxLives : 5;
  const empty = ready && lives <= 0;

  const play = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setNotice(null);
    const r = await onPlay();
    setStarting(false);
    if (r.ok || r.code === 'no_lives') return; // sem vidas: a Home ja oferece o video
    setNotice(r.offline ? t('home.offlineNotice') : r.error);
  }, [onPlay, starting]);

  const watchForLives = useCallback(async () => {
    setNotice(null);
    const r = await watchAdFor('lives');
    if (!r.ok && r.error) setNotice(r.error);
  }, [watchAdFor]);

  const retry = useCallback(() => {
    setNotice(null);
    economy.refresh();
  }, []);

  // Os cards so com o titulo: sem a linha de baixo, a Home cabe inteira na
  // tela de um celular comum, sem rolar. O que a linha dizia ja aparece no
  // proprio titulo ("Treinar", "Sem vidas") ou nas pilulas de cima.
  let primary;
  if (offline) {
    primary = { id: 'train', title: t('home.train'), onPress: onTrain };
  } else if (!ready) {
    primary = { id: 'loading', title: t('home.connecting') };
  } else if (empty) {
    primary = canWatch
      ? { id: 'refill', title: t('common.watchForLives'), onPress: watchForLives }
      : { id: 'refill', title: t('home.noLives') };
  } else {
    primary = { id: 'game', title: starting ? t('common.preparing') : t('home.play'), onPress: play };
  }

  const items = [
    { id: 'shop', title: t('home.shop') },
    { id: 'leaderboard', title: t('home.leaderboard') },
    { id: 'settings', title: t('home.settings') },
  ];

  // O que muda o tamanho do conteudo sem mudar a tela: idioma, aviso, faixa de
  // sem conexao. Mudou, mede de novo.
  const { scale, ready: medido, onLayout } = useFitScale(
    disponivel,
    `${getLanguage()}|${offline}|${notice || ''}|${primary.title}|${side}`
  );
  const z = (n) => n * scale;
  // O titulo tambem cabe na LARGURA: "MAJOR FLYER" ocupa ~8,6 vezes o tamanho
  // da fonte (com o espacamento). Numa tela estreita ele encolhe ate caber numa
  // linha so, em vez de quebrar em duas.
  const titulo = Math.min(z(36), (width - insets.left - insets.right - 48) / 8.6);

  return (
    <View style={styles.root}>
      <LinearGradient colors={SKY_GRADIENT} locations={[0, 0.3, 0.56, 0.8, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.vignette} />

      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + margem,
            paddingBottom: insets.bottom + margem,
            paddingLeft: insets.left + 24,
            paddingRight: insets.right + 24,
          },
        ]}
      >
        <View
          onLayout={onLayout}
          style={[styles.fit, side && styles.fitSide, { gap: side ? 44 : 0, opacity: medido ? 1 : 0 }]}
        >
          <View style={[styles.brand, side && styles.brandSide, { marginBottom: side ? 0 : z(28) }]}>
            {/* Mesma arte do icone/splash do app, em vez de um desenho paralelo. */}
            <Image
              source={require('../../assets/splash-icon.png')}
              style={{ width: z(side ? 108 : 148), height: z(side ? 108 : 148), marginBottom: -z(side ? 8 : 14) }}
              resizeMode="contain"
            />
            <Text style={[styles.title, { fontSize: titulo, letterSpacing: titulo / 9, textShadowRadius: titulo / 2 }]}>
              MAJOR FLYER
            </Text>
            <Text style={[styles.subtitle, { fontSize: z(13), lineHeight: z(19), marginTop: z(10) }]}>
              {t('home.tagline')}
            </Text>

            <View style={[styles.pills, { marginTop: z(20), gap: z(10) }]}>
              <View style={[styles.pill, pilula(z)]}>
                <Text style={[styles.pillLabel, { fontSize: z(11) }]}>{t('home.recordLabel')}</Text>
                <Text style={[styles.pillValue, { fontSize: z(20) }]}>{best}</Text>
              </View>
              {/* Moedas e vidas sao do servidor: sem ele, a pilula mostra traco em
                  vez de um numero que ninguem confirmou. */}
              <View style={[styles.pill, pilula(z), !ready && styles.pillWaiting]}>
                <CoinFace size={z(18)} />
                <Text style={[styles.pillValue, { fontSize: z(20) }]}>{ready ? wallet.coins : '—'}</Text>
              </View>
            </View>

            <View style={[styles.pill, pilula(z), { marginTop: z(10), gap: z(12) }, !ready && styles.pillWaiting]}>
              <Text style={[styles.pillLabel, { fontSize: z(11) }]}>{t('common.livesLabel')}</Text>
              <LifeBirds lives={ready ? lives : 0} total={maxLives} size={z(20)} gap={z(7)} />
            </View>

            {/* Tempo de voo: so o tempo voando de fato, somado pelo servidor a cada
                partida fechada. */}
            <View style={[styles.pill, pilula(z), { marginTop: z(10), gap: z(12) }, !ready && styles.pillWaiting]}>
              <Text style={[styles.pillLabel, { fontSize: z(11) }]}>{t('home.flightLabel')}</Text>
              <Text style={[styles.flightValue, { fontSize: z(18) }]}>
                {ready ? formatFlightTime(wallet.flightMs) : '—'}
              </Text>
            </View>

            {offline ? (
              <Pressable
                onPress={retry}
                style={({ pressed }) => [
                  styles.offline,
                  { marginTop: z(14), paddingVertical: z(8) },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.offlineTitle, { fontSize: z(11) }]}>{t('home.offlineTitle')}</Text>
                <Text style={[styles.offlineAction, { fontSize: z(11) }]}>{t('home.offlineAction')}</Text>
              </Pressable>
            ) : null}

            {notice ? (
              <Text style={[styles.notice, { fontSize: z(12), lineHeight: z(17), marginTop: z(12) }]}>{notice}</Text>
            ) : null}
          </View>

          <View style={[styles.menu, side && styles.menuSide, { gap: z(12) }]}>
            <MenuButton item={primary} primary z={z} onPress={primary.onPress} />
            {items.map((item) => (
              <MenuButton key={item.id} item={item} z={z} onPress={() => onNavigate(item.id)} />
            ))}
          </View>
        </View>
      </View>

      <AdCover state={adState} seconds={adSeconds} />
    </View>
  );
}

/** Os espacos de dentro de uma pilula, na escala da tela. */
function pilula(z) {
  return { paddingVertical: z(8), paddingHorizontal: z(18), gap: z(10) };
}

function MenuButton({ item, primary, z, onPress }) {
  const disabled = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.item,
        { paddingVertical: z(16), paddingHorizontal: z(20), borderRadius: z(18) },
        primary ? styles.itemPrimary : styles.itemGhost,
        disabled && { opacity: 0.6 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text style={[styles.itemTitle, { fontSize: z(18) }, primary && styles.itemTitlePrimary]} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={[styles.itemChevron, { fontSize: z(26) }, primary && styles.itemTitlePrimary]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.skyTop },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,9,26,0.45)' },

  // A tela inteira, sem rolagem: o bloco medido (fit) fica no centro.
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fit: { width: '100%', alignItems: 'center' },
  fitSide: { flexDirection: 'row', justifyContent: 'center' },

  brand: { alignItems: 'center', maxWidth: 400 },
  brandSide: { flex: 1, maxWidth: 340 },

  title: {
    color: theme.text,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: 'rgba(46,230,197,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  subtitle: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 10,
  },

  pills: { flexDirection: 'row' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  pillWaiting: { opacity: 0.45 },
  pillLabel: { color: theme.textDim, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  pillValue: { color: theme.bird, fontSize: 20, fontWeight: '900' },
  flightValue: { color: theme.bird, fontSize: 18, fontWeight: '900' },

  offline: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,92,122,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,92,122,0.4)',
  },
  offlineTitle: { color: theme.danger, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  offlineAction: { color: theme.textDim, fontSize: 11, marginTop: 2 },

  notice: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 320,
  },

  menu: { width: '100%', maxWidth: 380, gap: 12 },
  menuSide: { flex: 1, maxWidth: 340 },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
  },
  itemPrimary: {
    backgroundColor: theme.pillar,
    borderColor: theme.pillarLight,
    shadowColor: theme.pillar,
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  itemGhost: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.18)' },

  itemTitle: { flex: 1, color: theme.text, fontSize: 18, fontWeight: '800' },
  itemTitlePrimary: { color: '#04231D' },
  itemChevron: { color: theme.textDim, fontSize: 26, marginTop: -3 },
});

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoinFace } from '../game/render/Coin';
import useAds from '../hooks/useAds';
import useEconomy from '../hooks/useEconomy';
import economy from '../services/economy';
import AdCover from '../ui/AdCover';
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
  const side = width > height;

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
    setNotice(
      r.offline ? 'Sem conexão com o servidor. Dá para treinar enquanto isso.' : r.error
    );
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

  let primary;
  if (offline) {
    primary = {
      id: 'train',
      title: 'Treinar',
      subtitle: 'Sem internet: sem moedas, vidas ou ranking',
      onPress: onTrain,
    };
  } else if (!ready) {
    primary = { id: 'loading', title: 'Conectando...', subtitle: 'Buscando suas moedas e vidas' };
  } else if (empty) {
    primary = canWatch
      ? {
          id: 'refill',
          title: 'Assistir e ganhar 5 vidas',
          subtitle: 'Suas partidas acabaram',
          onPress: watchForLives,
        }
      : { id: 'refill', title: 'Sem vidas', subtitle: 'Nenhum anúncio disponível agora' };
  } else {
    primary = {
      id: 'game',
      title: starting ? 'Preparando...' : 'Jogar',
      subtitle: 'Toque para voar',
      onPress: play,
    };
  }

  const items = [
    {
      id: 'shop',
      title: 'Loja',
      subtitle: offline ? 'Precisa de internet' : 'Pássaros, escudos e novas chances',
    },
    { id: 'leaderboard', title: 'Ranking', subtitle: 'Compare seus voos' },
    { id: 'settings', title: 'Configurações', subtitle: 'Som e conta' },
  ];

  return (
    <View style={styles.root}>
      <LinearGradient colors={SKY_GRADIENT} locations={[0, 0.3, 0.56, 0.8, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.vignette} />

      <View
        style={[
          styles.content,
          side && styles.contentSide,
          {
            paddingTop: insets.top + (side ? 12 : 32),
            paddingBottom: insets.bottom + 24,
            paddingLeft: insets.left + 24,
            paddingRight: insets.right + 24,
          },
        ]}
      >
        <View style={[styles.brand, side && styles.brandSide]}>
          {/* Mesma arte do icone/splash do app, em vez de um desenho paralelo. */}
          <Image
            source={require('../../assets/splash-icon.png')}
            style={[styles.badge, side && styles.badgeSide]}
            resizeMode="contain"
          />
          <Text style={styles.title}>MAJOR FLYER</Text>
          <Text style={styles.subtitle}>
            Toque para bater as asas. Solte e a gravidade cobra o preço.
          </Text>

          <View style={styles.pills}>
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>RECORDE</Text>
              <Text style={styles.pillValue}>{best}</Text>
            </View>
            {/* Moedas e vidas sao do servidor: sem ele, a pilula mostra traco em
                vez de um numero que ninguem confirmou. */}
            <View style={[styles.pill, !ready && styles.pillWaiting]}>
              <CoinFace size={18} />
              <Text style={styles.pillValue}>{ready ? wallet.coins : '—'}</Text>
            </View>
          </View>

          <View style={[styles.pill, styles.livesPill, !ready && styles.pillWaiting]}>
            <Text style={styles.pillLabel}>VIDAS</Text>
            <LifeBirds lives={ready ? lives : 0} total={maxLives} size={20} gap={7} />
          </View>

          {offline ? (
            <Pressable onPress={retry} style={({ pressed }) => [styles.offline, pressed && { opacity: 0.7 }]}>
              <Text style={styles.offlineTitle}>SEM CONEXÃO · MODO TREINO</Text>
              <Text style={styles.offlineAction}>Tocar para tentar de novo</Text>
            </Pressable>
          ) : null}

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </View>

        <View style={[styles.menu, side && styles.menuSide]}>
          <MenuButton item={primary} primary onPress={primary.onPress} />
          {items.map((item) => (
            <MenuButton key={item.id} item={item} onPress={() => onNavigate(item.id)} />
          ))}
        </View>
      </View>

      <AdCover state={adState} seconds={adSeconds} />
    </View>
  );
}

function MenuButton({ item, primary, onPress }) {
  const disabled = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.item,
        primary ? styles.itemPrimary : styles.itemGhost,
        disabled && { opacity: 0.6 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemTitle, primary && styles.itemTitlePrimary]}>{item.title}</Text>
        <Text style={[styles.itemSubtitle, primary && styles.itemSubtitlePrimary]}>
          {item.subtitle}
        </Text>
      </View>
      <Text style={[styles.itemChevron, primary && styles.itemTitlePrimary]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.skyTop },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,9,26,0.45)' },

  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  contentSide: { flexDirection: 'row', gap: 44 },

  brand: { alignItems: 'center', maxWidth: 400, marginBottom: 30 },
  brandSide: { marginBottom: 0, flex: 1, maxWidth: 340 },

  // A arte ja traz o halo, entao nada de sombra por cima (que no Android
  // viraria `elevation` e mudaria a ordem de desenho).
  badge: { width: 148, height: 148, marginBottom: 8 },
  badgeSide: { width: 108, height: 108, marginBottom: 4 },

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

  pills: { flexDirection: 'row', gap: 10, marginTop: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  pillWaiting: { opacity: 0.45 },
  pillLabel: { color: theme.textDim, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  pillValue: { color: theme.bird, fontSize: 20, fontWeight: '900' },
  livesPill: { marginTop: 10, gap: 12 },

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
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 18,
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

  itemTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
  itemTitlePrimary: { color: '#04231D' },
  itemSubtitle: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  itemSubtitlePrimary: { color: 'rgba(4,35,29,0.7)' },
  itemChevron: { color: theme.textDim, fontSize: 26, marginTop: -3 },
});

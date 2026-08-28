import React, { useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import useAds from '../hooks/useAds';
import useLives from '../hooks/useLives';
import { MAX_LIVES } from '../services/lives';
import AdCover from '../ui/AdCover';
import LifeBirds from '../ui/LifeBirds';
import { SKY_GRADIENT, theme } from '../ui/theme';

// O botao de jogar e montado na hora (ele muda quando as vidas acabam); estes
// dois nunca mudam.
const ITEMS = [
  { id: 'leaderboard', title: 'Ranking', subtitle: 'Compare seus voos' },
  { id: 'settings', title: 'Configuracoes', subtitle: 'Som e conta' },
];

export default function HomeScreen({ onNavigate, onPlay, best }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { adState, adSeconds, showRewardedOrGrant } = useAds();
  const { lives, loaded: livesLoaded, refill } = useLives();

  // Em paisagem sobra largura e falta altura: marca de um lado, menu do outro.
  const side = width > height;

  // Enquanto o disco nao responde, a fileira mostra o tanque cheio meio apagado
  // — o numero de verdade chega em alguns milissegundos.
  const shown = livesLoaded ? lives : MAX_LIVES;
  const empty = livesLoaded && lives <= 0;

  /**
   * Sem partidas: um video premiado devolve as cinco. Se nao houver anuncio
   * nenhum para mostrar (sem SDK, sem IDs, na web), `showRewardedOrGrant` libera assim
   * mesmo — o jogo nunca fica trancado atras de um anuncio que nao existe.
   */
  const watchAd = useCallback(async () => {
    if (await showRewardedOrGrant()) refill();
  }, [showRewardedOrGrant, refill]);

  const playItem = empty
    ? { id: 'refill', title: 'Assistir e ganhar 5 vidas', subtitle: 'Suas partidas acabaram', primary: true }
    : { id: 'game', title: 'Jogar', subtitle: 'Toque para voar', primary: true };

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
            Toque para bater as asas. Solte e a gravidade cobra o preco.
          </Text>
          <View style={styles.bestPill}>
            <Text style={styles.bestLabel}>RECORDE</Text>
            <Text style={styles.bestValue}>{best}</Text>
          </View>

          {/* Cada partida iniciada apaga um passaro. Zerou, o video premiado
              devolve os cinco. */}
          <View style={[styles.livesPill, !livesLoaded && styles.livesPillWaiting]}>
            <Text style={styles.bestLabel}>PARTIDAS</Text>
            <LifeBirds lives={shown} size={20} gap={7} />
          </View>
        </View>

        <View style={[styles.menu, side && styles.menuSide]}>
          <MenuButton item={playItem} onPress={empty ? watchAd : onPlay} />
          {ITEMS.map((item) => (
            <MenuButton key={item.id} item={item} onPress={() => onNavigate(item.id)} />
          ))}
        </View>
      </View>

      <AdCover state={adState} seconds={adSeconds} />
    </View>
  );
}

function MenuButton({ item, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        item.primary ? styles.itemPrimary : styles.itemGhost,
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemTitle, item.primary && styles.itemTitlePrimary]}>{item.title}</Text>
        <Text style={[styles.itemSubtitle, item.primary && styles.itemSubtitlePrimary]}>
          {item.subtitle}
        </Text>
      </View>
      <Text style={[styles.itemChevron, item.primary && styles.itemTitlePrimary]}>›</Text>
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
  bestPill: {
    marginTop: 20,
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
  bestLabel: { color: theme.textDim, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  bestValue: { color: theme.bird, fontSize: 20, fontWeight: '900' },

  livesPill: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  livesPillWaiting: { opacity: 0.45 },

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

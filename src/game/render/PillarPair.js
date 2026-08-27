import React from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../ui/theme';

const COLUMN_COLORS = [theme.pillarDark, theme.pillar, theme.pillarLight, theme.pillar, theme.pillarDark];

function Column({ width, height, capAtBottom }) {
  const cap = Math.max(14, width * 0.26);
  return (
    <View style={{ width, height }}>
      <LinearGradient
        colors={COLUMN_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, top: 0, width, height, borderRadius: width * 0.14 }}
      />
      {/* faixa de brilho vertical */}
      <View
        style={{
          position: 'absolute',
          left: width * 0.22,
          top: 0,
          width: Math.max(2, width * 0.08),
          height,
          backgroundColor: 'rgba(255,255,255,0.35)',
        }}
      />
      {/* topo/base decorado, virado para o vao */}
      <LinearGradient
        colors={[theme.pillarLight, theme.pillar, theme.pillarDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          left: -width * 0.09,
          width: width * 1.18,
          height: cap,
          borderRadius: cap * 0.35,
          [capAtBottom ? 'bottom' : 'top']: 0,
          // sem `elevation`: no Android ela vira sombra cinza e reordena os
          // filhos. O contraste do topo ja vem do proprio gradiente.
          shadowColor: theme.pillar,
          shadowOpacity: 0.8,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
    </View>
  );
}

/**
 * Par de colunas. Cada metade tem altura fixa (playHeight) e sobra para fora
 * da tela; so o deslocamento vertical muda, entao nada e remontado durante o jogo.
 */
export default function PillarPair({ layout, x, topEdge, bottomEdge }) {
  const w = layout.pillarWidth;
  const h = layout.playHeight;

  return (
    <Animated.View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: -w / 2,
        top: 0,
        width: w,
        height: h,
        transform: [{ translateX: x }],
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: -h,
          width: w,
          height: h,
          transform: [{ translateY: topEdge }],
        }}
      >
        <Column width={w} height={h} capAtBottom />
      </Animated.View>

      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: w,
          height: h,
          transform: [{ translateY: bottomEdge }],
        }}
      >
        <Column width={w} height={h} capAtBottom={false} />
      </Animated.View>
    </Animated.View>
  );
}

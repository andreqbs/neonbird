import React, { useMemo } from 'react';
import { Animated, View } from 'react-native';

import { COIN_RADIUS } from '../coins';

/**
 * A moeda no vao de um obstaculo.
 *
 * Uma por coluna, montada uma vez: quem muda a cada frame e so a posicao
 * (`x` e `y`, animados), o giro compartilhado por todas (`spin`) e se ela esta
 * a vista (`visible`, que so troca quando a coluna nasce ou a moeda e pega).
 * `dx` e o quanto o ima (poder do Toxina) tirou a moeda do lugar, na
 * horizontal. Nada disso passa pelo React durante o voo.
 */
export default function Coin({ layout, x, dx, y, visible, spin }) {
  const r = layout.birdRadius * COIN_RADIUS;
  const d = r * 2;
  const left = useMemo(() => (dx ? Animated.add(x, dx) : x), [x, dx]);

  return (
    <Animated.View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: -r,
        top: -r,
        width: d,
        height: d,
        opacity: visible,
        transform: [{ translateX: left }, { translateY: y }, { scaleX: spin }],
      }}
    >
      <CoinFace size={d} />
    </Animated.View>
  );
}

/** O desenho da moeda, parado — tambem usado no placar e na loja. */
export function CoinFace({ size }) {
  const d = size;
  return (
    <View style={{ width: d, height: d }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: '#FFC933',
          borderWidth: Math.max(1, d * 0.1),
          borderColor: '#C98A12',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: d * 0.22,
          top: d * 0.22,
          width: d * 0.56,
          height: d * 0.56,
          borderRadius: d * 0.28,
          borderWidth: Math.max(1, d * 0.06),
          borderColor: '#FFE38A',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: d * 0.26,
          top: d * 0.16,
          width: d * 0.16,
          height: d * 0.28,
          borderRadius: d * 0.08,
          backgroundColor: 'rgba(255,255,255,0.75)',
        }}
      />
    </View>
  );
}

import React, { useMemo } from 'react';
import { Animated, View } from 'react-native';

import { COIN_RADIUS } from '../coins';

/**
 * Uma moeda da letra de moedas de um obstaculo (CoinLetter).
 *
 * Montada uma vez: `x` e `y` sao o lugar dela dentro da letra (mudam quando a
 * coluna ganha letra nova, ou enquanto o ima a puxa) e `visible` so troca quando
 * ela e pega. Nada disso passa pelo React durante o voo.
 *
 * `spin` e a fase do giro, de 0 a 1 em loop, rodando no lado NATIVO (GameScreen):
 * a moeda vira duas vezes por volta. Ele fica numa View so dele, por dentro — o
 * lado nativo nao aceita misturar, na mesma View, valor dele com valor que vem
 * do JS, como a posicao.
 */
export default function Coin({ layout, x, y, visible, spin }) {
  const r = layout.birdRadius * COIN_RADIUS;
  const d = r * 2;
  const scaleX = useMemo(
    () => spin.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.3, 1, 0.3, 1] }),
    [spin]
  );

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
        transform: [{ translateX: x }, { translateY: y }],
      }}
    >
      <Animated.View style={{ width: d, height: d, transform: [{ scaleX }] }}>
        <CoinFace size={d} />
      </Animated.View>
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

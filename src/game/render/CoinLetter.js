import React from 'react';
import { Animated } from 'react-native';

import Coin from './Coin';

/**
 * A letra de moedas no vao de um obstaculo (coins.js).
 *
 * Uma por coluna, montada uma vez, com lugar para a maior letra (13 moedas). A
 * letra inteira anda com a coluna: `x` e `y` movem so esta caixa, um valor por
 * frame. Cada moeda (`pieces`) tem o lugar dela na letra e se ainda esta a vista,
 * e isso so muda quando a coluna ganha uma letra nova, quando a moeda e pega, ou
 * enquanto o ima a puxa. Nada disso passa pelo React durante o voo.
 */
export default function CoinLetter({ layout, x, y, pieces, spin }) {
  return (
    <Animated.View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: 0,
        top: 0,
        transform: [{ translateX: x }, { translateY: y }],
      }}
    >
      {pieces.map((slot, i) => (
        <Coin key={i} layout={layout} x={slot.x} y={slot.y} visible={slot.on} spin={spin} />
      ))}
    </Animated.View>
  );
}

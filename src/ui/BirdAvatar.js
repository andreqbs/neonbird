import React from 'react';
import { View } from 'react-native';

import { lookFor } from '../game/birds';
import BirdFigure from '../game/render/BirdFigure';

/**
 * O passaro parado, com um halo — a vitrine da loja.
 *
 * E o mesmo desenho do voo (BirdFigure), so que sem animacao: o que o jogador
 * compra e exatamente o que vai voar. `size` e o diametro do corpo; a caixa
 * inteira tem folga para crista, rastro e bico.
 */
export default function BirdAvatar({ birdId, size = 36, style }) {
  const look = lookFor(birdId);
  const s = size;
  const pad = s * 0.42;
  const box = s + pad * 2;

  return (
    <View style={[{ width: box, height: box }, style]}>
      <View
        style={{
          position: 'absolute',
          left: box * 0.08,
          top: box * 0.08,
          width: box * 0.84,
          height: box * 0.84,
          borderRadius: box * 0.42,
          backgroundColor: look.glow,
          opacity: 0.16,
        }}
      />
      <View style={{ position: 'absolute', left: pad, top: pad, width: s, height: s }}>
        <BirdFigure s={s} look={look} wingRotate="-10deg" />
      </View>
    </View>
  );
}

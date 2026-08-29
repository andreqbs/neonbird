import React from 'react';
import { Animated, View } from 'react-native';

const RED = '#FF3B57';

/**
 * O aviso de que a gravidade vai dobrar: uma seta vermelha para baixo, no canto
 * da tela, dois segundos antes de o peso entrar.
 *
 * Ele fica FORA do desenho das colunas de proposito. A gravidade nao pertence a
 * obstaculo nenhum — vale para a fase inteira —, entao avisar em cima de um
 * cano diria a coisa errada: o jogador procuraria a armadilha naquele obstaculo.
 *
 * A seta e desenhada com Views (haste + triangulo de borda), sem fonte de icone
 * nem imagem: escala em qualquer densidade e nao adiciona asset ao bundle.
 */
export default function GravityWarning({ opacity, size = 46, style }) {
  const stem = Math.max(3, size * 0.13);
  const head = size * 0.19;

  return (
    <Animated.View
      style={[
        {
          pointerEvents: 'none',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: Math.max(2, size * 0.055),
          borderColor: RED,
          backgroundColor: 'rgba(30,6,16,0.55)',
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
        },
        style,
      ]}
    >
      {/* haste */}
      <View
        style={{
          width: stem,
          height: size * 0.3,
          borderRadius: stem / 2,
          backgroundColor: RED,
        }}
      />
      {/* ponta: triangulo apontando para baixo */}
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: head,
          borderRightWidth: head,
          borderTopWidth: head * 1.15,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: RED,
          marginTop: -1,
        }}
      />
    </Animated.View>
  );
}

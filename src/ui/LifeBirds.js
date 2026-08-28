import React from 'react';
import { StyleSheet, View } from 'react-native';

import { MAX_LIVES } from '../services/lives';
import { theme } from './theme';

/**
 * As vidas do jogador, desenhadas como uma fileira de passaros.
 *
 * A vida gasta NAO some da fileira: fica transparente. O jogador precisa ver
 * quantas partidas ele tinha para entender quantas ainda lhe restam — uma
 * fileira que encolhe nao conta essa historia.
 *
 * Mesmo desenho do passaro do jogo (View sobre View, sem imagem), entao escala
 * em qualquer densidade de tela e acompanha a paleta do tema.
 */
export default function LifeBirds({ lives, total = MAX_LIVES, size = 26, gap = 8, style }) {
  return (
    <View style={[styles.row, { gap }, style]}>
      {Array.from({ length: total }, (_, i) => (
        <LifeBird key={i} size={size} spent={i >= lives} />
      ))}
    </View>
  );
}

function LifeBird({ size, spent }) {
  const s = size;
  return (
    <View style={{ width: s, height: s, opacity: spent ? 0.18 : 1 }}>
      {/* corpo */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: s,
          height: s,
          borderRadius: s / 2,
          backgroundColor: theme.bird,
          borderWidth: Math.max(1, s * 0.06),
          borderColor: theme.birdDeep,
        }}
      />
      {/* asa */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.12,
          top: s * 0.44,
          width: s * 0.5,
          height: s * 0.26,
          borderRadius: s * 0.13,
          backgroundColor: theme.birdWing,
        }}
      />
      {/* olho */}
      <View
        style={{
          position: 'absolute',
          right: s * 0.2,
          top: s * 0.24,
          width: s * 0.26,
          height: s * 0.26,
          borderRadius: s * 0.13,
          backgroundColor: '#FFFFFF',
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: s * 0.23,
          top: s * 0.31,
          width: s * 0.12,
          height: s * 0.12,
          borderRadius: s * 0.06,
          backgroundColor: '#1A1330',
        }}
      />
      {/* bico */}
      <View
        style={{
          position: 'absolute',
          right: -s * 0.14,
          top: s * 0.5,
          width: s * 0.28,
          height: s * 0.16,
          borderTopRightRadius: s * 0.08,
          borderBottomRightRadius: s * 0.12,
          backgroundColor: theme.beak,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});

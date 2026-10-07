import React from 'react';
import { Text, View } from 'react-native';

/**
 * Trofeu do podio do ranking: ouro no 1º, prata no 2º e cobre no 3º, com a
 * posicao escrita na taca. Desenhado com View, como o resto do jogo — emoji de
 * trofeu so existe dourado.
 */
const CORES = {
  1: { cup: '#FFC83D', deep: '#B07800', shine: '#FFE58A', text: '#5A3A00' },
  2: { cup: '#D8DEF2', deep: '#8E97B5', shine: '#FFFFFF', text: '#3A4160' },
  3: { cup: '#D2834A', deep: '#8A4A1F', shine: '#F2B98C', text: '#3F1F08' },
};

export default function Trophy({ rank, size = 28 }) {
  const c = CORES[rank];
  if (!c) return null;
  const s = size;
  const alca = {
    position: 'absolute',
    top: s * 0.12,
    width: s * 0.24,
    height: s * 0.28,
    borderRadius: s * 0.12,
    borderWidth: Math.max(1.5, s * 0.07),
    borderColor: c.deep,
  };
  return (
    <View style={{ width: s, height: s }} accessibilityLabel={`${rank}`}>
      {/* alcas, atras da taca */}
      <View style={[alca, { left: s * 0.06 }]} />
      <View style={[alca, { right: s * 0.06 }]} />
      {/* taca */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.19,
          top: s * 0.06,
          width: s * 0.62,
          height: s * 0.5,
          borderTopLeftRadius: s * 0.06,
          borderTopRightRadius: s * 0.06,
          borderBottomLeftRadius: s * 0.31,
          borderBottomRightRadius: s * 0.31,
          backgroundColor: c.cup,
          borderWidth: Math.max(1, s * 0.04),
          borderColor: c.deep,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: c.text, fontSize: s * 0.3, fontWeight: '900', marginTop: -s * 0.04 }}>{rank}</Text>
      </View>
      {/* brilho */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.27,
          top: s * 0.12,
          width: s * 0.07,
          height: s * 0.24,
          borderRadius: s * 0.035,
          backgroundColor: c.shine,
          opacity: 0.8,
        }}
      />
      {/* haste e base */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.43,
          top: s * 0.55,
          width: s * 0.14,
          height: s * 0.17,
          backgroundColor: c.deep,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: s * 0.24,
          top: s * 0.71,
          width: s * 0.52,
          height: s * 0.16,
          borderRadius: s * 0.05,
          backgroundColor: c.cup,
          borderWidth: Math.max(1, s * 0.04),
          borderColor: c.deep,
        }}
      />
    </View>
  );
}

import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { theme } from './theme';

/**
 * A cobertura que fica na frente de tudo enquanto o anuncio roda, engolindo os
 * toques para ninguem bater asa (nem apertar um botao) por tras do video.
 *
 * As medidas sao explicitas em vez de `absoluteFill`: no Android o par
 * top/bottom dentro de um pai posicionado resolvia altura zero e a cobertura
 * sumia (na web funcionava).
 */
export default function AdCover({ state, seconds }) {
  const { width, height } = useWindowDimensions();
  if (state === 'idle') return null;

  const simulated = state === 'simulating';
  return (
    <View style={[styles.cover, { width, height }]}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {simulated ? 'Propaganda (simulacao)' : 'Carregando anuncio...'}
        </Text>
        <Text style={styles.text}>
          {simulated
            ? 'Aqui entra o video premiado quando o AdMob estiver configurado.'
            : 'O video abre em instantes.'}
        </Text>
        {simulated && <Text style={styles.seconds}>{seconds}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: 'rgba(3,5,16,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { alignItems: 'center', paddingHorizontal: 32, maxWidth: 340 },
  title: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  text: { color: theme.textDim, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  seconds: { color: theme.pillar, fontSize: 44, fontWeight: '900', marginTop: 14 },
});

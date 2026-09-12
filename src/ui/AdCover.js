import React from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { theme } from './theme';

/**
 * A cobertura que fica na frente de tudo enquanto o anuncio roda — e enquanto o
 * servidor confirma o premio —, engolindo os toques para ninguem bater asa (nem
 * apertar um botao) por tras.
 *
 * As medidas sao explicitas em vez de `absoluteFill`: no Android o par
 * top/bottom dentro de um pai posicionado resolvia altura zero e a cobertura
 * sumia (na web funcionava).
 */
export default function AdCover({ state, seconds }) {
  const { width, height } = useWindowDimensions();
  if (state === 'idle') return null;

  const simulated = state === 'simulating';
  const confirming = state === 'confirming';

  let title = 'Carregando anúncio...';
  let text = 'O vídeo abre em instantes.';
  if (simulated) {
    title = 'Propaganda (simulação)';
    text = 'Aqui entra o vídeo premiado quando o AdMob estiver configurado.';
  } else if (confirming) {
    title = 'Confirmando o prêmio...';
    text = 'O prêmio é registrado no servidor assim que o Google confirma o vídeo.';
  }

  return (
    <View style={[styles.cover, { width, height }]}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>{text}</Text>
        {simulated ? <Text style={styles.seconds}>{seconds}</Text> : null}
        {confirming ? <ActivityIndicator color={theme.pillar} style={{ marginTop: 16 }} /> : null}
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

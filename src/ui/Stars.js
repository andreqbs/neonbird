import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from './theme';

/**
 * As estrelas de um passaro: quantas ele ja tem, de quantas cabem.
 *
 * Cada estrela se compra com moedas na loja e estica o tempo do poder dele —
 * quem guarda o nivel e faz a conta e o servidor (server/catalog.go).
 */
export default function Stars({ level = 0, total = 5, size = 13, style }) {
  if (!total) return null;
  return (
    <View style={[styles.row, style]}>
      {Array.from({ length: total }, (_, i) => (
        <Text key={i} style={[styles.star, { fontSize: size }, i < level ? styles.on : styles.off]}>
          {i < level ? '★' : '☆'}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 1, marginTop: 3 },
  star: { fontWeight: '900' },
  on: { color: theme.bird },
  off: { color: 'rgba(150,161,206,0.55)' },
});

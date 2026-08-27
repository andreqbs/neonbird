import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SKY_GRADIENT, theme } from './theme';

/**
 * Moldura das telas fora do jogo. Cuida do fundo, do recorte de tela (notch,
 * que em paisagem vai parar na lateral) e de manter o conteudo legivel numa
 * coluna central, independente da orientacao.
 */
export default function Screen({ title, onBack, children, footer, contentStyle }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <LinearGradient colors={SKY_GRADIENT} locations={[0, 0.3, 0.56, 0.8, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.vignette} />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
        {(title || onBack) && (
          <View style={styles.header}>
            {onBack ? (
              <Pressable
                onPress={onBack}
                hitSlop={12}
                style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.backIcon}>‹</Text>
                <Text style={styles.backLabel}>Voltar</Text>
              </Pressable>
            ) : (
              <View style={styles.back} />
            )}
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.back} />
          </View>
        )}

        <ScrollView
          contentContainerStyle={[styles.scroll, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </View>
  );
}

export function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.skyTop },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,9,26,0.5)' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { minWidth: 86, flexDirection: 'row', alignItems: 'center' },
  backIcon: { color: theme.pillar, fontSize: 30, lineHeight: 32, marginRight: 2, marginTop: -4 },
  backLabel: { color: theme.pillar, fontSize: 15, fontWeight: '700' },
  title: {
    flex: 1,
    textAlign: 'center',
    color: theme.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  scroll: { paddingHorizontal: 20, paddingBottom: 32, alignItems: 'center' },
  column: { width: '100%', maxWidth: 520 },

  footer: { paddingHorizontal: 20, paddingBottom: 12, alignItems: 'center' },

  sectionTitle: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    borderRadius: 20,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.22)',
    overflow: 'hidden',
  },
});

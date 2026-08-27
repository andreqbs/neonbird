import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from './theme';

export default function Button({ title, onPress, variant = 'primary', style, compact }) {
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        primary ? styles.primary : styles.ghost,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.label, compact && styles.labelCompact, !primary && styles.labelGhost]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  compact: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  primary: {
    backgroundColor: theme.pillar,
    borderColor: theme.pillarLight,
    shadowColor: theme.pillar,
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.22)' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  label: { color: '#04231D', fontSize: 17, fontWeight: '800', letterSpacing: 0.4 },
  labelCompact: { fontSize: 14 },
  labelGhost: { color: theme.text, fontWeight: '700' },
});

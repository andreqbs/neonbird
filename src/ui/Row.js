import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { theme } from './theme';

/** Linha de configuracao com interruptor. */
export function ToggleRow({ label, description, value, onValueChange, disabled, last }) {
  return (
    <View style={[styles.row, last && styles.last, disabled && styles.disabled]}>
      <View style={styles.texts}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: 'rgba(46,230,197,0.55)' }}
        thumbColor={value ? theme.pillar : '#C8CEE6'}
        ios_backgroundColor="rgba(255,255,255,0.18)"
      />
    </View>
  );
}

/** Linha clicavel, com um valor ou acao a direita. */
export function ActionRow({ label, description, value, onPress, danger, last, disabled }) {
  const body = (
    <View style={[styles.row, last && styles.last, disabled && styles.disabled]}>
      <View style={styles.texts}>
        <Text style={[styles.label, danger && { color: theme.danger }]}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {onPress && !disabled ? <Text style={styles.chevron}>›</Text> : null}
    </View>
  );

  if (!onPress || disabled) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.65 }}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    gap: 12,
  },
  last: { borderBottomWidth: 0 },
  disabled: { opacity: 0.45 },
  texts: { flex: 1 },
  label: { color: theme.text, fontSize: 15, fontWeight: '700' },
  description: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 3 },
  value: { color: theme.textDim, fontSize: 14, fontWeight: '600' },
  chevron: { color: theme.textDim, fontSize: 22, marginLeft: 2, marginTop: -2 },
});

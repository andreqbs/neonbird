import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from './theme';

/**
 * Abas em pilula, uma do lado da outra — as do ranking e as da loja.
 *
 * `tabs` e a lista [{ id, label }]; `value` e o id da aba aberta.
 */
export default function Tabs({ tabs, value, onChange, style }) {
  return (
    <View style={[styles.tabs, style]}>
      {tabs.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onChange(t.id)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === t.id }}
          style={({ pressed }) => [
            styles.tab,
            value === t.id && styles.tabActive,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={[styles.tabLabel, value === t.id && styles.tabLabelActive]}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    marginTop: 6,
    marginBottom: 14,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: 'rgba(46,230,197,0.18)' },
  tabLabel: { color: theme.textDim, fontSize: 14, fontWeight: '700' },
  tabLabelActive: { color: theme.pillar },
});

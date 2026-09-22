import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { POWER_ICONS } from '../game/powers';
import { theme } from './theme';

/**
 * Os poderes do passaro durante o voo, no canto da tela: um por linha.
 *
 * Poder com relogio (ima, invisivel, mais lento) mostra uma barra: enchendo
 * enquanto recarrega, esvaziando enquanto esta ligado — e a linha acende quando
 * ele liga. Poder sem relogio (moedas multiplicadas, chance extra) aparece so
 * como lembrete, sempre aceso de leve.
 *
 * `powers` e a lista fixa da partida; `values` sao os valores animados de cada
 * poder com relogio ({ level, active }), empurrados pelo loop do jogo sem passar
 * pelo React.
 */
export default function PowerHud({ powers, values, top, left }) {
  if (!powers || powers.length === 0) return null;
  return (
    <View style={[styles.wrap, { top, left }]}>
      {powers.map((p) => {
        const v = values[p.id];
        return v ? <TimedPower key={p.id} power={p} value={v} /> : <PassivePower key={p.id} power={p} />;
      })}
    </View>
  );
}

function TimedPower({ power, value }) {
  const cor = COLORS[power.id] || theme.pillar;
  const brilho = value.active.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const borda = value.active.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,255,255,0.12)', cor],
  });
  const largura = value.level.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View style={[styles.chip, { opacity: brilho, borderColor: borda }]}>
      <Text style={styles.icon}>{POWER_ICONS[power.id]}</Text>
      <View style={styles.texts}>
        <Text style={styles.name} numberOfLines={1}>
          {power.name}
        </Text>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width: largura, backgroundColor: cor }]} />
        </View>
      </View>
    </Animated.View>
  );
}

function PassivePower({ power }) {
  return (
    <View style={[styles.chip, { opacity: 0.8 }]}>
      <Text style={styles.icon}>{POWER_ICONS[power.id]}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {power.name}
      </Text>
    </View>
  );
}

// A cor de cada poder quando liga.
const COLORS = {
  magnet: '#FF5C7A',
  ghost: '#C9B8FF',
  slow: '#8FF7FF',
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', pointerEvents: 'none', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    paddingLeft: 6,
    paddingRight: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(8,12,34,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  icon: { fontSize: 14 },
  texts: { gap: 3 },
  name: { color: theme.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  track: {
    width: 54,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2 },
});

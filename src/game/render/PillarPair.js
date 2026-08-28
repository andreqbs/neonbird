import React from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { stageAt } from '../stages';

/**
 * Uma metade da coluna. A forma inteira vem da tabela da fase (`stages.js`):
 * raio do corpo, altura e raio do topo, brilho, rebites e nucleo. E por isso
 * que "trocar o obstaculo" e so mexer em numeros, sem componente novo.
 */
function Column({ width, height, capAtBottom, look }) {
  const cap = Math.max(14, width * look.capRatio);
  const capColor = look.cap[1];

  return (
    <View style={{ width, height }}>
      <LinearGradient
        colors={look.body}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          borderRadius: width * look.bodyRadius,
        }}
      />
      {/* faixa de brilho vertical */}
      <View
        style={{
          position: 'absolute',
          left: width * 0.22,
          top: 0,
          width: Math.max(2, width * 0.08),
          height,
          backgroundColor: `rgba(255,255,255,${look.shine})`,
        }}
      />
      {/* nucleo brilhante correndo pelo meio (fases de energia) */}
      {look.core ? (
        <View
          style={{
            position: 'absolute',
            left: width * 0.5 - Math.max(1.5, width * 0.03),
            top: 0,
            width: Math.max(3, width * 0.06),
            height,
            backgroundColor: look.core,
            opacity: 0.55,
          }}
        />
      ) : null}
      {/* topo/base decorado, virado para o vao */}
      <LinearGradient
        colors={look.cap}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          left: -width * 0.09,
          width: width * 1.18,
          height: cap,
          borderRadius: cap * look.capRadius,
          [capAtBottom ? 'bottom' : 'top']: 0,
          // sem `elevation`: no Android ela vira sombra cinza e reordena os
          // filhos. O contraste do topo ja vem do proprio gradiente.
          shadowColor: capColor,
          shadowOpacity: 0.8,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      {/* rebites: duas faixas escuras no topo, cara de chapa parafusada */}
      {look.rivets
        ? [0.3, 0.7].map((t) => (
            <View
              key={t}
              style={{
                position: 'absolute',
                left: width * 0.14,
                right: width * 0.14,
                height: Math.max(2, cap * 0.1),
                borderRadius: 2,
                backgroundColor: 'rgba(0,0,0,0.32)',
                [capAtBottom ? 'bottom' : 'top']: cap * t,
              }}
            />
          ))
        : null}
    </View>
  );
}

/**
 * Par de colunas. Cada metade tem altura fixa (playHeight) e sobra para fora
 * da tela; so o deslocamento vertical muda, entao nada e remontado durante o jogo.
 */
export default function PillarPair({ layout, x, topEdge, bottomEdge, stage }) {
  const w = layout.pillarWidth;
  const h = layout.playHeight;
  const look = (typeof stage === 'object' && stage ? stage : stageAt(stage || 0)).pillar;

  return (
    <Animated.View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: -w / 2,
        top: 0,
        width: w,
        height: h,
        transform: [{ translateX: x }],
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: -h,
          width: w,
          height: h,
          transform: [{ translateY: topEdge }],
        }}
      >
        <Column width={w} height={h} capAtBottom look={look} />
      </Animated.View>

      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: w,
          height: h,
          transform: [{ translateY: bottomEdge }],
        }}
      >
        <Column width={w} height={h} capAtBottom={false} look={look} />
      </Animated.View>
    </Animated.View>
  );
}

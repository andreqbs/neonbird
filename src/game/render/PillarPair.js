import React from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { stageAt } from '../stages';

/** Cor do aviso: a mesma da armadilha em qualquer fase, para nao dar duvida. */
const WARN_COLOR = '#FF3B57';

const ICE = {
  body: 'rgba(202,240,255,0.94)',
  edge: 'rgba(255,255,255,0.9)',
  deep: 'rgba(120,200,235,0.95)',
};

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
 * O bloco de gelo que sai da ponta do cano: tres cubos de alturas diferentes,
 * para nao parecer que o cano simplesmente cresceu.
 *
 * `atTop` diz de que lado ele nasce — os cubos ficam colados na ponta do cano e
 * as pontas soltas apontam para dentro do vao.
 */
function IceBlock({ width, size, atTop }) {
  const cubes = [0.82, 1, 0.72];
  const slot = width / cubes.length;

  return (
    <View style={{ width, height: size }}>
      {cubes.map((h, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: i * slot + slot * 0.06,
            width: slot * 0.88,
            height: size * h,
            [atTop ? 'top' : 'bottom']: 0,
            borderRadius: Math.max(2, size * 0.16),
            backgroundColor: ICE.body,
            borderWidth: Math.max(1, size * 0.05),
            borderColor: ICE.edge,
          }}
        />
      ))}
      {/* sombra fria na raiz, onde o gelo encosta no cano */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          width,
          height: Math.max(2, size * 0.22),
          [atTop ? 'top' : 'bottom']: 0,
          backgroundColor: ICE.deep,
          opacity: 0.55,
        }}
      />
    </View>
  );
}

/**
 * Par de colunas. Cada metade tem altura fixa (playHeight) e sobra para fora
 * da tela; so o deslocamento vertical muda, entao nada e remontado durante o jogo.
 *
 * ARMADILHA DE GELO: o bloco vive dentro de uma janela de altura fixa
 * (`iceMax`) com `overflow: hidden`, e quem se move e o bloco la dentro. Anima
 * `transform`, e nao `height`: altura animada refaz o layout a cada frame, e
 * este componente roda 60 vezes por segundo com o jogo inteiro na frente.
 */
export default function PillarPair({
  layout,
  x,
  topEdge,
  bottomEdge,
  stage,
  iceMax = 0,
  iceTop,
  iceBottom,
  warnTop,
  warnBottom,
  driftGlow,
}) {
  const w = layout.pillarWidth;
  const h = layout.playHeight;
  const look = (typeof stage === 'object' && stage ? stage : stageAt(stage || 0)).pillar;
  const radius = w * look.bodyRadius;
  const hasIce = iceMax > 0 && iceTop && iceBottom;

  /**
   * Brilho de quando a coluna esta deslizando (fase do vao que se mexe).
   *
   * Usa a cor CLARA do proprio cano, e nao o vermelho das outras armadilhas: o
   * vermelho quer dizer "perigo chegando", e aqui nao ha perigo novo — o vao
   * continua do mesmo tamanho, so mudou de lugar. O que o brilho faz e chamar o
   * olho para a coluna certa no meio de uma tela em que tudo ja se move.
   */
  const glow = (side) =>
    driftGlow ? (
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: w,
          height: h,
          borderRadius: radius,
          backgroundColor: look.cap[0],
          opacity: driftGlow,
        }}
        key={side}
      />
    ) : null;

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
        {glow('top')}
        {/* aviso: o cano inteiro pisca em vermelho antes de soltar o gelo */}
        {warnTop ? (
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: w,
              height: h,
              borderRadius: radius,
              backgroundColor: WARN_COLOR,
              opacity: warnTop,
            }}
          />
        ) : null}
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
        {glow('bottom')}
        {warnBottom ? (
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: w,
              height: h,
              borderRadius: radius,
              backgroundColor: WARN_COLOR,
              opacity: warnBottom,
            }}
          />
        ) : null}
      </Animated.View>

      {hasIce ? (
        <>
          {/* gelo do cano de cima: nasce em topEdge e desce para o vao */}
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: w,
              height: iceMax,
              overflow: 'hidden',
              transform: [{ translateY: topEdge }],
            }}
          >
            <Animated.View style={{ transform: [{ translateY: Animated.subtract(iceTop, iceMax) }] }}>
              <IceBlock width={w} size={iceMax} atTop />
            </Animated.View>
          </Animated.View>

          {/* gelo do cano de baixo: a janela termina em bottomEdge e o bloco sobe */}
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: w,
              height: iceMax,
              overflow: 'hidden',
              transform: [{ translateY: Animated.subtract(bottomEdge, iceMax) }],
            }}
          >
            <Animated.View
              style={{ transform: [{ translateY: Animated.subtract(iceMax, iceBottom) }] }}
            >
              <IceBlock width={w} size={iceMax} atTop={false} />
            </Animated.View>
          </Animated.View>
        </>
      ) : null}
    </Animated.View>
  );
}

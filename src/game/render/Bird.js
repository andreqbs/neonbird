import React from 'react';
import { Animated, View } from 'react-native';
import { theme } from '../../ui/theme';

/**
 * Passaro desenhado apenas com Views (sem imagens), entao escala perfeitamente
 * em qualquer densidade de tela. A posicao vem de Animated.Value, ou seja,
 * atualiza sem re-renderizar a arvore React a cada frame.
 *
 * Nada aqui depende de API especifica de plataforma:
 *  - o brilho e feito com circulos concentricos, e nao com sombra. `shadow*`
 *    so pinta halo colorido na web/iOS; no Android viraria `elevation`, que
 *    alem de dar sombra cinza AINDA reordena os filhos (o halo era desenhado
 *    por cima do corpo, do olho e do bico — dai o passaro "feio" no Android).
 *  - as pecas que saem do corpo (cauda e bico) ficam dentro de uma caixa com
 *    folga, entao nenhuma plataforma as recorta.
 * Resultado: o mesmo desenho na web, no Android e no iOS.
 */
export default function Bird({ layout, y, rotation, wing, shield, shieldLevel }) {
  const s = layout.birdRadius * 2; // diametro do corpo
  const pad = s * 0.42; // folga para halo, cauda e bico
  const box = s + pad * 2;

  // Tres aneis com opacidade crescente imitam a queda suave de um halo.
  const HALO = [
    { size: box, opacity: 0.08 },
    { size: box - pad * 0.7, opacity: 0.13 },
    { size: box - pad * 1.3, opacity: 0.2 },
  ];

  const rotate = rotation.interpolate({
    inputRange: [-90, 90],
    outputRange: ['-90deg', '90deg'],
    extrapolate: 'clamp',
  });

  const wingRotate = wing.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-34deg', '26deg'],
    extrapolate: 'clamp',
  });

  // O escudo nao apaga de uma vez: `shieldLevel` cai de 1 a 0 durante a
  // dissipacao, e a opacidade acompanha. Os degraus no fim da faixa fazem o
  // anel piscar duas vezes antes de acabar — como o nivel cai junto com o
  // tempo, oscilar no nivel e oscilar no tempo, sem um segundo relogio.
  const shieldOpacity = shieldLevel.interpolate({
    inputRange: [0, 0.12, 0.24, 0.36, 0.48, 1],
    outputRange: [0, 0.85, 0.3, 0.85, 0.4, 0.9],
    extrapolate: 'clamp',
  });
  // Dissipar tambem e abrir: o anel cresce um pouco enquanto perde a cor.
  const shieldScale = shieldLevel.interpolate({
    inputRange: [0, 1],
    outputRange: [1.18, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: layout.birdX - box / 2,
        top: -box / 2,
        width: box,
        height: box,
        transform: [{ translateY: y }, { rotate }],
      }}
    >
      {/* brilho: circulos concentricos no lugar de sombra */}
      {HALO.map((ring, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: (box - ring.size) / 2,
            top: (box - ring.size) / 2,
            width: ring.size,
            height: ring.size,
            borderRadius: ring.size / 2,
            backgroundColor: theme.bird,
            opacity: ring.opacity,
          }}
        />
      ))}

      {/* corpo do passaro, centrado na caixa */}
      <View style={{ position: 'absolute', left: pad, top: pad, width: s, height: s }}>
        {/* corpo */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: s,
            height: s,
            borderRadius: s / 2,
            backgroundColor: theme.bird,
            borderWidth: Math.max(1, s * 0.05),
            borderColor: theme.birdDeep,
          }}
        />
        {/* barriga */}
        <View
          style={{
            position: 'absolute',
            left: s * 0.16,
            bottom: s * 0.1,
            width: s * 0.6,
            height: s * 0.4,
            borderRadius: s * 0.3,
            backgroundColor: '#FFF0B8',
            opacity: 0.75,
          }}
        />
        {/* cauda */}
        <View
          style={{
            position: 'absolute',
            left: -s * 0.16,
            top: s * 0.36,
            width: s * 0.3,
            height: s * 0.24,
            borderTopLeftRadius: s * 0.12,
            borderBottomLeftRadius: s * 0.12,
            backgroundColor: theme.birdWing,
          }}
        />
        {/* asa */}
        <Animated.View
          style={{
            position: 'absolute',
            left: s * 0.1,
            top: s * 0.38,
            width: s * 0.52,
            height: s * 0.3,
            borderRadius: s * 0.16,
            backgroundColor: theme.birdWing,
            transform: [{ rotate: wingRotate }],
          }}
        />
        {/* olho */}
        <View
          style={{
            position: 'absolute',
            right: s * 0.16,
            top: s * 0.2,
            width: s * 0.3,
            height: s * 0.3,
            borderRadius: s * 0.15,
            backgroundColor: '#FFFFFF',
          }}
        />
        <View
          style={{
            position: 'absolute',
            right: s * 0.18,
            top: s * 0.27,
            width: s * 0.14,
            height: s * 0.14,
            borderRadius: s * 0.07,
            backgroundColor: '#1A1330',
          }}
        />
        {/* bico */}
        <View
          style={{
            position: 'absolute',
            right: -s * 0.2,
            top: s * 0.5,
            width: s * 0.34,
            height: s * 0.2,
            borderTopRightRadius: s * 0.1,
            borderBottomRightRadius: s * 0.16,
            backgroundColor: theme.beak,
          }}
        />
      </View>

      {/* Escudo do anuncio premiado: um anel em volta do passaro. A primeira
          batida nao o apaga — ela comeca a dissipacao, e enquanto sobrar anel
          na tela toda colisao continua sendo perdoada. O que o jogador ve e
          exatamente quanto de perdao ainda lhe resta. */}
      {shield ? (
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: box,
            height: box,
            borderRadius: box / 2,
            borderWidth: Math.max(2, s * 0.08),
            borderColor: theme.shield,
            opacity: shieldOpacity,
            transform: [{ scale: shieldScale }],
          }}
        />
      ) : null}
    </Animated.View>
  );
}

import React from 'react';
import { Animated, View } from 'react-native';

/**
 * O desenho do passaro, sem posicao nem halo: corpo, barriga, cauda, asa, olho,
 * bico e os acessorios do visual (birds.js).
 *
 * Mora separado para servir a dois lugares: o voo (Bird, com asa animada) e a
 * loja (BirdAvatar, parado). O que se compra na loja e exatamente o que voa.
 *
 * `s` e o diametro do corpo. Tudo e medido em fracao dele, e as pecas que saem
 * do corpo (crista, rastro, bico) ficam dentro da folga que quem chama reserva
 * em volta — nenhuma plataforma as recorta. O passaro de sempre sai com as
 * mesmas medidas de antes desta separacao.
 */
export default function BirdFigure({ s, look, wingRotate = '0deg' }) {
  const eye = look.visor ? (
    <Visor s={s} color={look.visor} />
  ) : (
    <>
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
    </>
  );

  return (
    <>
      {/* atras do corpo: rastro e crista (so a ponta aparece) */}
      {look.tail ? <Tail s={s} colors={look.tail} /> : null}
      {look.crest ? <Crest s={s} crest={look.crest} /> : null}

      {/* corpo */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: s,
          height: s,
          borderRadius: s / 2,
          backgroundColor: look.body,
          borderWidth: Math.max(1, s * 0.05),
          borderColor: look.deep,
          opacity: look.bodyOpacity ?? 1,
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
          backgroundColor: look.belly,
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
          backgroundColor: look.wing,
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
          backgroundColor: look.wing,
          transform: [{ rotate: wingRotate }],
        }}
      />
      {/* mascara: por baixo do olho, por cima do corpo */}
      {look.mask ? (
        <View
          style={{
            position: 'absolute',
            left: s * 0.36,
            top: s * 0.17,
            width: s * 0.66,
            height: s * 0.34,
            borderRadius: s * 0.17,
            backgroundColor: look.mask,
          }}
        />
      ) : null}
      {eye}
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
          backgroundColor: look.beak,
        }}
      />
    </>
  );
}

/** Visor no lugar do olho: uma faixa com um reflexo. */
function Visor({ s, color }) {
  return (
    <>
      <View
        style={{
          position: 'absolute',
          right: -s * 0.02,
          top: s * 0.24,
          width: s * 0.52,
          height: s * 0.17,
          borderRadius: s * 0.085,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: s * 0.08,
          top: s * 0.27,
          width: s * 0.16,
          height: Math.max(1, s * 0.05),
          borderRadius: s * 0.025,
          backgroundColor: '#FFFFFF',
          opacity: 0.8,
        }}
      />
    </>
  );
}

/** Rastro do cometa: duas faixas saindo de tras do corpo. */
function Tail({ s, colors }) {
  const faixas = [
    { top: s * 0.3, width: s * 0.55, height: s * 0.13, color: colors[0], opacity: 0.85 },
    { top: s * 0.52, width: s * 0.46, height: s * 0.1, color: colors[1], opacity: 0.75 },
  ];
  return faixas.map((f, i) => (
    <View
      key={i}
      style={{
        position: 'absolute',
        left: -s * 0.4,
        top: f.top,
        width: f.width,
        height: f.height,
        borderRadius: f.height / 2,
        backgroundColor: f.color,
        opacity: f.opacity,
      }}
    />
  ));
}

/** Topete: cristais de gelo, chamas ou antena. */
function Crest({ s, crest }) {
  if (crest.kind === 'crystals') {
    return [
      { left: 0.3, size: 0.16 },
      { left: 0.44, size: 0.22 },
      { left: 0.6, size: 0.16 },
    ].map((c, i) => (
      <View
        key={i}
        style={{
          position: 'absolute',
          left: s * c.left,
          top: -s * c.size * 0.45,
          width: s * c.size,
          height: s * c.size,
          borderRadius: s * 0.02,
          backgroundColor: crest.color,
          borderWidth: Math.max(1, s * 0.025),
          borderColor: crest.edge,
          transform: [{ rotate: '45deg' }],
        }}
      />
    ));
  }

  if (crest.kind === 'flame') {
    return [
      { left: 0.26, height: 0.3, rotate: '-20deg' },
      { left: 0.4, height: 0.42, rotate: '0deg' },
      { left: 0.54, height: 0.28, rotate: '18deg' },
    ].map((f, i) => (
      <View
        key={i}
        style={{
          position: 'absolute',
          left: s * f.left,
          top: s * (0.18 - f.height),
          width: s * 0.17,
          height: s * f.height,
          borderRadius: s * 0.085,
          backgroundColor: crest.colors[i % crest.colors.length],
          transform: [{ rotate: f.rotate }],
        }}
      />
    ));
  }

  if (crest.kind === 'antenna') {
    const haste = Math.max(1.5, s * 0.05);
    return (
      <>
        <View
          style={{
            position: 'absolute',
            left: s * 0.56,
            top: -s * 0.2,
            width: haste,
            height: s * 0.32,
            borderRadius: haste / 2,
            backgroundColor: crest.color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.56 + haste / 2 - s * 0.07,
            top: -s * 0.27,
            width: s * 0.14,
            height: s * 0.14,
            borderRadius: s * 0.07,
            backgroundColor: crest.tip,
          }}
        />
      </>
    );
  }

  return null;
}

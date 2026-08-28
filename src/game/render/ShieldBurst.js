import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { theme } from '../../ui/theme';

/** Duracao do estilhaco, em ms. Quem monta o componente usa para desmontar. */
export const BURST_DURATION = 520;

const SHARDS = 10;

/**
 * O escudo se partindo: o anel arrebenta para fora e os cacos saem em leque,
 * girando e perdendo opacidade.
 *
 * O truque de posicionamento e a ordem do `transform`: `rotate` primeiro gira o
 * sistema de coordenadas do caco, e o `translateY` seguinte o empurra ao longo
 * desse eixo ja girado. Dez cacos com angulos diferentes viram um circulo, sem
 * um seno sequer.
 *
 * A animacao roda no driver de JS de proposito: com o nativo, um re-render da
 * tela (troca de fase, escudo absorvendo outra batida) reaplica os props e
 * reinicia o valor no meio do estilhaco.
 */
function ShieldBurst({ layout, y }) {
  const t = useRef(null);
  if (t.current === null) t.current = new Animated.Value(0);

  useEffect(() => {
    Animated.timing(t.current, {
      toValue: 1,
      duration: BURST_DURATION,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, []);

  // Mesmo enquadramento do passaro, para o estilhaco nascer exatamente onde o
  // anel estava.
  const s = layout.birdRadius * 2;
  const pad = s * 0.42;
  const box = s + pad * 2;
  const inner = box / 2;

  const shardW = Math.max(3, s * 0.18);
  const shardH = Math.max(2, s * 0.09);

  const fade = t.current.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.8, 0],
  });
  const ringFade = t.current.interpolate({
    inputRange: [0, 0.35],
    outputRange: [0.9, 0],
    extrapolate: 'clamp',
  });
  const ringScale = t.current.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });

  return (
    <Animated.View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: layout.birdX - box / 2,
        top: -box / 2,
        width: box,
        height: box,
        transform: [{ translateY: y }],
      }}
    >
      {/* o anel abrindo, o primeiro a sumir */}
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
          opacity: ringFade,
          transform: [{ scale: ringScale }],
        }}
      />

      {Array.from({ length: SHARDS }, (_, i) => {
        // Variacao deterministica: cada caco voa um pouco mais longe que o
        // vizinho, sem sorteio (o mesmo estilhaco toda vez, sem state extra).
        const spread = box * (0.72 + ((i * 37) % 45) / 100);
        const distance = t.current.interpolate({
          inputRange: [0, 1],
          outputRange: [-inner, -spread],
        });
        const spin = t.current.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${i % 2 === 0 ? 70 : -70}deg`],
        });

        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: box / 2 - shardW / 2,
              top: box / 2 - shardH / 2,
              width: shardW,
              height: shardH,
              borderRadius: shardH / 2,
              backgroundColor: theme.shield,
              opacity: fade,
              transform: [
                { rotate: `${(360 / SHARDS) * i}deg` },
                { translateY: distance },
                { rotate: spin },
              ],
            }}
          />
        );
      })}
    </Animated.View>
  );
}

// memo: a tela re-renderiza por motivos que nao dizem respeito ao estilhaco —
// ele so precisa da posicao do passaro, que e um Animated.Value estavel.
export default React.memo(ShieldBurst);

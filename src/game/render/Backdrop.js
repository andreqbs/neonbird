import React, { useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { stageAt } from '../stages';

// PRNG com semente: o cenario e sempre o mesmo entre renders,
// sem precisar guardar nada em state.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SKY_TILE_RATIO = 1; // a faixa de predios tem a largura da tela

export default function Backdrop({ layout, skyOffset, stage }) {
  const { width, playHeight, groundHeight } = layout;
  // `stage` pode vir como indice ou como objeto ja resolvido.
  const look = typeof stage === 'object' && stage ? stage : stageAt(stage || 0);
  const skylineHeight = playHeight * look.skyline.height;

  const stars = useMemo(() => {
    const rnd = mulberry32(7);
    const count = Math.round(((width * playHeight) / 14000) * look.star.density);
    return Array.from({ length: Math.min(Math.max(count, 12), 90) }, (_, i) => ({
      key: `s${i}`,
      left: rnd() * width,
      top: rnd() * playHeight * 0.62,
      size: 1 + rnd() * 2.2,
      opacity: 0.25 + rnd() * 0.6,
    }));
  }, [width, playHeight, look.star.density]);

  // A silhueta do fundo muda de cara por fase so pelo topo: quadrado vira
  // torre, torre vira copa de arvore. Mesma geometria, tres cenarios.
  const buildings = useMemo(() => {
    const rnd = mulberry32(19);
    const out = [];
    let x = 0;
    while (x < width) {
      const w = width * (0.05 + rnd() * 0.07);
      const h = skylineHeight * (0.3 + rnd() * 0.7);
      out.push({ key: `b${out.length}`, x, w, h, far: rnd() > 0.55 });
      x += w + width * 0.012;
    }
    return out;
  }, [width, skylineHeight]);

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <LinearGradient
        colors={look.sky}
        locations={[0, 0.3, 0.56, 0.8, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: playHeight }}
      />

      {stars.map((s) => (
        <View
          key={s.key}
          style={{
            position: 'absolute',
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            borderRadius: s.size,
            backgroundColor: look.star.color,
            opacity: s.opacity,
          }}
        />
      ))}

      {/* halo do horizonte */}
      <View
        style={{
          position: 'absolute',
          left: -width * 0.2,
          width: width * 1.4,
          height: width * 0.5,
          bottom: groundHeight - width * 0.3,
          borderRadius: width * 0.7,
          backgroundColor: look.horizon.color,
          opacity: look.horizon.opacity,
        }}
      />

      {/* skyline com parallax: duas copias lado a lado que se repetem */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          bottom: groundHeight,
          width: width * 2,
          height: skylineHeight,
          flexDirection: 'row',
          transform: [{ translateX: skyOffset }],
        }}
      >
        {[0, 1].map((copy) => (
          <View key={copy} style={{ width, height: '100%' }}>
            {buildings.map((b) => (
              <View
                key={b.key}
                style={{
                  position: 'absolute',
                  left: b.x,
                  bottom: 0,
                  width: b.w,
                  height: b.h,
                  backgroundColor: b.far ? look.cityFar : look.city,
                  borderTopLeftRadius: Math.min(look.skyline.topRadius, b.w / 2),
                  borderTopRightRadius: Math.min(look.skyline.topRadius, b.w / 2),
                  opacity: b.far ? 0.65 : 0.9,
                }}
              />
            ))}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

import React from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { stageAt } from '../stages';

export const GROUND_TILE = 46;

export default function Ground({ layout, offset, stage }) {
  const count = Math.ceil(layout.width / GROUND_TILE) + 2;
  const look = (typeof stage === 'object' && stage ? stage : stageAt(stage || 0)).ground;

  return (
    <View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: layout.groundHeight,
        overflow: 'hidden',
      }}
    >
      <LinearGradient
        colors={look.gradient}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 3,
          backgroundColor: look.line,
          shadowColor: look.line,
          shadowOpacity: 0.9,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 3,
          bottom: 0,
          width: count * GROUND_TILE,
          flexDirection: 'row',
          transform: [{ translateX: offset }],
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ width: GROUND_TILE, height: '100%' }}>
            <View
              style={{
                position: 'absolute',
                left: 6,
                top: 7,
                width: GROUND_TILE * 0.42,
                height: 3,
                borderRadius: 2,
                backgroundColor: look.dashA,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: GROUND_TILE * 0.58,
                top: 18,
                width: GROUND_TILE * 0.3,
                height: 3,
                borderRadius: 2,
                backgroundColor: look.dashB,
              }}
            />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

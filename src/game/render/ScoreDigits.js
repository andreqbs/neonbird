import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Animated, Text, View } from 'react-native';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Numero desenhado como rolo de digitos.
 *
 * POR QUE NAO E SO UM <Text>: no Android o placar chegava atrasado. Nao era o
 * jogo — o som do ponto saia na hora, e o passaro corria liso —, era o React.
 * Cada ponto pedia um render, e esse render entra na fila DEPOIS do game loop,
 * que a essa altura ja empurrou uns vinte valores animados naquele mesmo frame.
 * Na web o commit e barato e ninguem nota; no celular, com a arvore do jogo
 * inteira para reconciliar, o numero aparecia segundos depois do obstaculo.
 *
 * Aqui cada casa e uma coluna com os dez digitos empilhados, e trocar o numero
 * e mover um `translateY`. Ou seja: o placar passa a andar pelo MESMO caminho
 * que o passaro e as colunas — o unico que ja estava chegando em dia.
 *
 * `centered`: as casas nao usadas continuam ocupando espaco (o layout e fixo,
 * senao voltariamos a precisar de render). Para o numero nao ficar torto na
 * tela, o rolo inteiro desliza meia casa para cada zero escondido.
 */
const ScoreDigits = forwardRef(function ScoreDigits(
  { places = 4, value = 0, fontSize = 24, centered = false, style },
  ref
) {
  // Caixa folgada de proposito: o recorte de cada casa nao pode comer o brilho
  // do texto (textShadow), que sobra bem alem do glifo.
  const line = Math.round(fontSize * 1.3);
  const width = Math.round(fontSize * 0.78);

  const anim = useRef(null);
  if (anim.current === null) {
    anim.current = {
      // Indice 0 e a casa das unidades: e a ordem em que o numero se desfaz.
      cells: Array.from({ length: places }, () => ({
        y: new Animated.Value(0),
        opacity: new Animated.Value(0),
      })),
      shift: new Animated.Value(0),
    };
  }
  const { cells, shift } = anim.current;

  const apply = useRef(null);
  if (apply.current === null) {
    apply.current = (next) => {
      let rest = Math.max(0, Math.floor(Number.isFinite(next) ? next : 0));
      let used = 0;
      for (let i = 0; i < places; i++) {
        const digit = rest % 10;
        const visible = i === 0 || rest > 0; // zero a esquerda nao se mostra
        if (visible) used = i + 1;
        cells[i].y.setValue(-digit * line);
        cells[i].opacity.setValue(visible ? 1 : 0);
        rest = Math.floor(rest / 10);
      }
      // Sinal negativo: as casas escondidas ficam a ESQUERDA, entao o rolo
      // precisa andar para a esquerda para o numero visivel cair no meio.
      shift.setValue(centered ? -((places - used) * width) / 2 : 0);
    };
  }

  // Primeiro desenho: o mundo pode ja vir com placar (rotacao no meio do voo).
  const mounted = useRef(false);
  if (!mounted.current) {
    mounted.current = true;
    apply.current(value);
  }

  useImperativeHandle(ref, () => ({ set: (n) => apply.current(n) }), []);

  const cellStyle = [style, { height: line, lineHeight: line, width, textAlign: 'center' }];

  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        height: line,
        transform: [{ translateX: shift }],
      }}
    >
      {/* Da casa mais alta para a mais baixa: na tela o numero se le ao contrario
          da ordem em que ele e desmontado. */}
      {cells
        .map((cell, i) => ({ cell, i }))
        .reverse()
        .map(({ cell, i }) => (
          <View key={i} style={{ width, height: line, overflow: 'hidden' }}>
            <Animated.View
              style={{ transform: [{ translateY: cell.y }], opacity: cell.opacity }}
            >
              {DIGITS.map((d) => (
                <Text key={d} style={cellStyle} allowFontScaling={false}>
                  {d}
                </Text>
              ))}
            </Animated.View>
          </View>
        ))}
    </Animated.View>
  );
});

export default ScoreDigits;

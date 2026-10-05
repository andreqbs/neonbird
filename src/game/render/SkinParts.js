import React from 'react';
import { Animated, View } from 'react-native';

/**
 * O desenho das skins em cima do passaro: bone, asas, oculos e colar.
 *
 * Quem chama e o BirdFigure, entao a skin sai igual no voo, na loja e no
 * ranking. Tudo e View sobre View, medido em fracao de `s` (o diametro do
 * corpo), com o passaro olhando para a direita: o olho fica em torno de
 * (0,69 s; 0,35 s), o bico sai na altura de 0,5 s e a asa vai de 0,1 s a 0,62 s.
 * As pecas que saem do corpo ficam dentro da folga que quem chama reserva em
 * volta (0,42 s de cada lado), como a crista e o rastro.
 *
 * As cores de cada skin moram em skins.js; aqui so o formato de cada modelo.
 */

const linha = (s, f) => Math.max(1, s * f);

// ====================================================================== BONE

/**
 * Bone no alto da cabeca, com a aba para a frente e um pouco inclinado. Tira
 * o lugar da crista (quem chama ja a esconde). A helice do bone de helice
 * balanca junto com a batida da asa (`rotate`).
 */
export function SkinCap({ s, skin, rotate }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: s * 0.14,
        top: -s * 0.27,
        width: s * 0.92,
        height: s * 0.46,
        transform: [{ rotate: '6deg' }],
      }}
    >
      {skin.kind === 'propeller' ? (
        <PropellerCrown s={s} skin={skin} rotate={rotate} />
      ) : (
        <Crown s={s} skin={skin} />
      )}
      {/* aba */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.5,
          top: s * 0.33,
          width: s * 0.42,
          height: s * 0.09,
          borderRadius: s * 0.045,
          backgroundColor: skin.brim,
        }}
      />
    </View>
  );
}

const COPA = { left: 0.06, top: 0.07, width: 0.62, height: 0.34 };

function Crown({ s, skin }) {
  const w = s * COPA.width;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: s * COPA.left,
          top: s * COPA.top,
          width: w,
          height: s * COPA.height,
          borderTopLeftRadius: w / 2,
          borderTopRightRadius: w / 2,
          borderBottomLeftRadius: s * 0.04,
          borderBottomRightRadius: s * 0.04,
          backgroundColor: skin.crown,
          borderWidth: linha(s, 0.03),
          borderColor: skin.edge,
        }}
      />
      {skin.stripe ? (
        <View
          style={{
            position: 'absolute',
            left: s * (COPA.left + 0.02),
            top: s * 0.31,
            width: w - s * 0.04,
            height: linha(s, 0.05),
            backgroundColor: skin.stripe,
            opacity: 0.9,
          }}
        />
      ) : null}
      {/* botao no topo */}
      <View
        style={{
          position: 'absolute',
          left: s * COPA.left + w / 2 - s * 0.05,
          top: s * 0.03,
          width: s * 0.1,
          height: s * 0.1,
          borderRadius: s * 0.05,
          backgroundColor: skin.button,
        }}
      />
    </>
  );
}

function PropellerCrown({ s, skin, rotate }) {
  const metade = (s * COPA.width) / 2;
  const meio = s * COPA.left + metade;
  return (
    <>
      {/* copa em duas metades, cada uma de uma cor */}
      <View
        style={{
          position: 'absolute',
          left: s * COPA.left,
          top: s * COPA.top,
          width: metade,
          height: s * COPA.height,
          borderTopLeftRadius: metade,
          borderBottomLeftRadius: s * 0.04,
          backgroundColor: skin.left,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: meio,
          top: s * COPA.top,
          width: metade,
          height: s * COPA.height,
          borderTopRightRadius: metade,
          borderBottomRightRadius: s * 0.04,
          backgroundColor: skin.right,
        }}
      />
      {/* costura do meio */}
      <View
        style={{
          position: 'absolute',
          left: meio - s * 0.025,
          top: s * COPA.top,
          width: s * 0.05,
          height: s * COPA.height,
          backgroundColor: skin.middle,
        }}
      />
      {/* haste */}
      <View
        style={{
          position: 'absolute',
          left: meio - s * 0.02,
          top: -s * 0.06,
          width: s * 0.04,
          height: s * 0.14,
          backgroundColor: skin.edge,
        }}
      />
      {/* helice */}
      <Animated.View
        style={{
          position: 'absolute',
          left: meio - s * 0.22,
          top: -s * 0.1,
          width: s * 0.44,
          height: s * 0.08,
          transform: [{ rotate }],
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: s * 0.2,
            height: s * 0.08,
            borderRadius: s * 0.04,
            backgroundColor: skin.blades[0],
          }}
        />
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: s * 0.2,
            height: s * 0.08,
            borderRadius: s * 0.04,
            backgroundColor: skin.blades[1],
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: s * 0.18,
            top: 0,
            width: s * 0.08,
            height: s * 0.08,
            borderRadius: s * 0.04,
            backgroundColor: skin.edge,
          }}
        />
      </Animated.View>
    </>
  );
}

// ====================================================================== ASAS

/**
 * Asas no lugar da asa do passaro: a mesma caixa e a mesma batida (`rotate`),
 * mas maiores, saindo para tras.
 */
export function SkinWings({ s, skin, rotate }) {
  let desenho = null;
  if (skin.kind === 'feathers') desenho = <Feathers s={s} skin={skin} />;
  else if (skin.kind === 'bat') desenho = <BatWing s={s} skin={skin} />;
  else if (skin.kind === 'butterfly') desenho = <ButterflyWing s={s} skin={skin} />;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: s * 0.1,
        top: s * 0.38,
        width: s * 0.52,
        height: s * 0.3,
        transform: [{ rotate }],
      }}
    >
      {desenho}
    </Animated.View>
  );
}

// O ombro: onde as penas se prendem, na ponta da frente da asa.
const OMBRO = { x: 0.44, y: 0.13 };

/**
 * Asa de anjo: penas compridas presas no ombro, abertas em leque para tras e
 * para cima. A de baixo, na frente, e a mais clara.
 */
function Feathers({ s, skin }) {
  const penas = [
    { length: 0.8, height: 0.17, angle: 30, color: skin.colors[2] },
    { length: 0.74, height: 0.17, angle: 15, color: skin.colors[1] },
    { length: 0.62, height: 0.16, angle: 1, color: skin.colors[0] },
  ];
  return penas.map((p, i) => (
    <View
      key={i}
      style={{
        position: 'absolute',
        left: s * (OMBRO.x - p.length),
        top: s * (OMBRO.y - p.height / 2),
        width: s * p.length,
        height: s * p.height,
        borderRadius: (s * p.height) / 2,
        backgroundColor: p.color,
        borderWidth: linha(s, 0.02),
        borderColor: skin.edge,
        // Gira presa pela ponta da frente: a de tras sobe.
        transformOrigin: 'right center',
        transform: [{ rotate: `${p.angle}deg` }],
      }}
    />
  ));
}

/**
 * Asa de morcego: tres gomos de membrana escura presos no ombro, em leque, cada
 * um com a ponta fina em cima e o osso na borda.
 */
function BatWing({ s, skin }) {
  const gomos = [
    { length: 0.82, height: 0.18, angle: 34 },
    { length: 0.72, height: 0.18, angle: 16 },
    { length: 0.58, height: 0.17, angle: -2 },
  ];
  return gomos.map((g, i) => (
    <View
      key={i}
      style={{
        position: 'absolute',
        left: s * (OMBRO.x - g.length),
        top: s * (OMBRO.y - g.height / 2),
        width: s * g.length,
        height: s * g.height,
        // Ponta fina em cima e barriga redonda embaixo: o recorte do morcego.
        borderTopLeftRadius: s * 0.02,
        borderBottomLeftRadius: s * 0.15,
        borderTopRightRadius: s * 0.04,
        borderBottomRightRadius: s * 0.08,
        backgroundColor: skin.membrane,
        transformOrigin: 'right center',
        transform: [{ rotate: `${g.angle}deg` }],
      }}
    >
      {/* o osso, na borda de cima do gomo (gira junto com ele) */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: linha(s, 0.03),
          borderRadius: s * 0.015,
          backgroundColor: skin.bone,
        }}
      />
    </View>
  ));
}

/** Asa de borboleta: duas abas coloridas com pintas. */
function ButterflyWing({ s, skin }) {
  const aba = (left, top, width, height, rotate, color) => ({
    position: 'absolute',
    left: s * left,
    top: s * top,
    width: s * width,
    height: s * height,
    borderRadius: (s * Math.min(width, height)) / 2,
    backgroundColor: color,
    borderWidth: linha(s, 0.03),
    borderColor: skin.edge,
    transform: [{ rotate }],
  });
  const pinta = (left, top, size, color) => ({
    position: 'absolute',
    left: s * left,
    top: s * top,
    width: s * size,
    height: s * size,
    borderRadius: (s * size) / 2,
    backgroundColor: color,
  });
  return (
    <>
      <View style={aba(-0.04, 0.1, 0.34, 0.26, '20deg', skin.lower)} />
      <View style={aba(-0.12, -0.18, 0.46, 0.34, '-24deg', skin.upper)} />
      <View style={pinta(0.0, -0.06, 0.09, skin.spot)} />
      <View style={pinta(0.15, -0.1, 0.06, skin.spot)} />
      <View style={pinta(0.07, 0.17, 0.07, skin.upper)} />
    </>
  );
}

// ==================================================================== OCULOS

/** Oculos em cima do olho: a lente de perto cobre o olho, a de longe aparece na frente do rosto. */
export function SkinGlasses({ s, skin }) {
  if (skin.kind === 'pixel') return <PixelGlasses s={s} skin={skin} />;

  const tresD = skin.kind === '3d';
  const aro = linha(s, tresD ? 0.035 : 0.025);
  // Escuro: lente de aviador, mais redonda embaixo. 3D: retangular.
  const cantos = (cima, baixo) => ({
    borderTopLeftRadius: s * cima,
    borderTopRightRadius: s * cima,
    borderBottomLeftRadius: s * baixo,
    borderBottomRightRadius: s * baixo,
  });
  const forma = tresD ? cantos(0.03, 0.03) : cantos(0.06, 0.13);
  const formaLonge = tresD ? cantos(0.03, 0.03) : cantos(0.04, 0.08);

  return (
    <>
      {/* haste, para tras */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.22,
          top: s * 0.29,
          width: s * 0.3,
          height: linha(s, 0.04),
          backgroundColor: skin.frame,
        }}
      />
      {/* ponte */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.86,
          top: s * 0.29,
          width: s * 0.11,
          height: linha(s, 0.04),
          backgroundColor: skin.frame,
        }}
      />
      {/* lente de perto */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.5,
          top: s * 0.22,
          width: s * 0.38,
          height: s * 0.27,
          ...forma,
          backgroundColor: tresD ? skin.near : skin.lens,
          borderWidth: aro,
          borderColor: skin.frame,
          opacity: tresD ? 0.92 : 1,
        }}
      />
      {/* lente de longe */}
      <View
        style={{
          position: 'absolute',
          left: s * 0.96,
          top: s * 0.24,
          width: s * 0.17,
          height: s * 0.23,
          ...formaLonge,
          backgroundColor: tresD ? skin.far : skin.lens,
          borderWidth: aro,
          borderColor: skin.frame,
          opacity: tresD ? 0.92 : 1,
        }}
      />
      {skin.shine ? (
        <View
          style={{
            position: 'absolute',
            left: s * 0.58,
            top: s * 0.28,
            width: s * 0.12,
            height: linha(s, 0.035),
            borderRadius: s * 0.02,
            backgroundColor: skin.shine,
            opacity: 0.75,
            transform: [{ rotate: '-25deg' }],
          }}
        />
      ) : null}
    </>
  );
}

/** Oculos de oito bits: fileiras de "pixels" pretos, em degrau, e um pixel de brilho. */
function PixelGlasses({ s, skin }) {
  const p = s * 0.065;
  const y = s * 0.24;
  const blocos = [
    { left: s * 0.2, top: s * 0.27, width: s * 0.3, height: linha(s, 0.045) }, // haste
    { left: s * 0.48, top: y, width: s * 0.66, height: p }, // barra de cima, das duas lentes
    { left: s * 0.5, top: y + p, width: s * 0.36, height: p },
    { left: s * 0.56, top: y + 2 * p, width: s * 0.24, height: p },
    { left: s * 0.96, top: y + p, width: s * 0.16, height: p },
    { left: s * 0.99, top: y + 2 * p, width: s * 0.1, height: p },
  ];
  return (
    <>
      {blocos.map((b, i) => (
        <View key={i} style={{ position: 'absolute', ...b, backgroundColor: skin.color }} />
      ))}
      <View
        style={{
          position: 'absolute',
          left: s * 0.56,
          top: y + p,
          width: p * 0.9,
          height: p * 0.9,
          backgroundColor: skin.shine,
        }}
      />
    </>
  );
}

// ==================================================================== COLAR

// O colar faz um U por baixo do rosto: arco de centro (0,68 s; 0,5 s) e raio
// 0,27 s, de 22 a 158 graus. A ponta da frente some atras do bico. Todo elo tem
// contorno escuro: ouro sobre o passaro amarelo de sempre quase sumia.
const ARCO = { cx: 0.68, cy: 0.5, r: 0.27, de: 22, ate: 158 };

function pontosDoArco(n) {
  const pontos = [];
  for (let i = 0; i < n; i++) {
    const graus = ARCO.de + ((ARCO.ate - ARCO.de) * i) / (n - 1);
    const rad = (graus * Math.PI) / 180;
    pontos.push({ x: ARCO.cx + ARCO.r * Math.cos(rad), y: ARCO.cy + ARCO.r * Math.sin(rad) });
  }
  return pontos;
}

export function SkinNecklace({ s, skin }) {
  if (skin.kind === 'chain') {
    // Elos grossos de ouro, alternando o tamanho.
    return pontosDoArco(10).map((p, i) => {
      const d = s * (i % 2 ? 0.085 : 0.11);
      return (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: s * p.x - d / 2,
            top: s * p.y - d / 2,
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: skin.gold,
            borderWidth: linha(s, 0.02),
            borderColor: skin.deep,
          }}
        />
      );
    });
  }

  // Medalhao e diamante: corrente fina de contas de ouro e o pingente no fundo do U.
  const conta = s * 0.06;
  const corrente = pontosDoArco(12).map((p, i) => (
    <View
      key={i}
      style={{
        position: 'absolute',
        left: s * p.x - conta / 2,
        top: s * p.y - conta / 2,
        width: conta,
        height: conta,
        borderRadius: conta / 2,
        backgroundColor: skin.gold,
        borderWidth: linha(s, 0.012),
        borderColor: skin.deep,
      }}
    />
  ));
  const fundoX = s * ARCO.cx;
  const fundoY = s * (ARCO.cy + ARCO.r);

  if (skin.kind === 'medal') {
    const d = s * 0.24;
    const miolo = s * 0.13;
    return (
      <>
        {corrente}
        <View
          style={{
            position: 'absolute',
            left: fundoX - d / 2,
            top: fundoY - s * 0.03,
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: skin.gold,
            borderWidth: linha(s, 0.03),
            borderColor: skin.deep,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: fundoX - miolo / 2,
            top: fundoY - s * 0.03 + (d - miolo) / 2,
            width: miolo,
            height: miolo,
            borderRadius: miolo / 2,
            backgroundColor: skin.light,
          }}
        />
      </>
    );
  }

  if (skin.kind === 'diamond') {
    const pedra = s * 0.15;
    return (
      <>
        {corrente}
        {/* engaste */}
        <View
          style={{
            position: 'absolute',
            left: fundoX - s * 0.04,
            top: fundoY - s * 0.01,
            width: s * 0.08,
            height: s * 0.05,
            borderRadius: s * 0.02,
            backgroundColor: skin.gold,
          }}
        />
        {/* a pedra: um quadrado em pe */}
        <View
          style={{
            position: 'absolute',
            left: fundoX - pedra / 2,
            top: fundoY + s * 0.02,
            width: pedra,
            height: pedra,
            backgroundColor: skin.gem,
            borderWidth: linha(s, 0.02),
            borderColor: skin.gemEdge,
            transform: [{ rotate: '45deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: fundoX - s * 0.035,
            top: fundoY + s * 0.055,
            width: s * 0.035,
            height: s * 0.035,
            borderRadius: s * 0.02,
            backgroundColor: '#FFFFFF',
            opacity: 0.9,
          }}
        />
      </>
    );
  }

  return null;
}

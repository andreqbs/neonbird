/**
 * A aparencia de cada skin — os enfeites do passaro: bone, asas, oculos e colar.
 *
 * So o DESENHO mora aqui: nome, encaixe, preco e produto vem do servidor
 * (server/catalog.go). A loja esconde a skin que o servidor mande e o app ainda
 * nao saiba desenhar; no voo e no ranking ela simplesmente nao aparece.
 *
 * Cada entrada diz o encaixe (`slot`), o modelo do desenho (`kind`) e as cores;
 * quem desenha e o SkinParts, com View sobre View, como o proprio passaro. Nada
 * de imagem: escala em qualquer tela, igual ao resto do jogo.
 *
 * O encaixe precisa bater com o do servidor — o teste (npm test) confere os ids
 * e os encaixes das duas pontas.
 */
export const SKIN_LOOKS = {
  // ------------------------------------------------------------------ bones
  cap_red: {
    slot: 'cap',
    kind: 'cap',
    crown: '#E53935',
    edge: '#9E1B1B',
    brim: '#C62828',
    button: '#FFFFFF',
  },
  cap_neon: {
    slot: 'cap',
    kind: 'cap',
    crown: '#1F2233',
    edge: '#05060C',
    brim: '#39FF88',
    button: '#39FF88',
    stripe: '#39FF88',
  },
  cap_propeller: {
    slot: 'cap',
    kind: 'propeller',
    left: '#FF3B30',
    right: '#2979FF',
    middle: '#FFD23F',
    edge: '#5A1E1E',
    brim: '#22C55E',
    blades: ['#FFD23F', '#FF3B30'],
  },

  // ------------------------------------------------------------------- asas
  wings_angel: {
    slot: 'wings',
    kind: 'feathers',
    colors: ['#FFFFFF', '#F4F8FF', '#E8F1FF'],
    edge: '#BFD8F5',
  },
  wings_bat: {
    slot: 'wings',
    kind: 'bat',
    membrane: '#5B2C83',
    bone: '#2B1240',
  },
  wings_butterfly: {
    slot: 'wings',
    kind: 'butterfly',
    upper: '#FF4FA3',
    lower: '#9B5CFF',
    edge: '#7A1F5C',
    spot: '#FFFFFF',
  },

  // ----------------------------------------------------------------- oculos
  glasses_sun: {
    slot: 'glasses',
    kind: 'shades',
    lens: '#111318',
    frame: '#3A3F4B',
    shine: '#FFFFFF',
  },
  glasses_3d: {
    slot: 'glasses',
    kind: '3d',
    frame: '#FFFFFF',
    near: '#FF3355',
    far: '#22D3EE',
  },
  glasses_pixel: {
    slot: 'glasses',
    kind: 'pixel',
    color: '#0B0B0F',
    shine: '#FFFFFF',
  },

  // ---------------------------------------------------------------- colares
  necklace_chain: {
    slot: 'necklace',
    kind: 'chain',
    gold: '#FFC83D',
    deep: '#B07800',
  },
  necklace_medal: {
    slot: 'necklace',
    kind: 'medal',
    gold: '#FFC83D',
    light: '#FFE58A',
    deep: '#B07800',
  },
  necklace_diamond: {
    slot: 'necklace',
    kind: 'diamond',
    gold: '#FFC83D',
    deep: '#B07800',
    gem: '#4FC3F7',
    gemEdge: '#E1F5FE',
  },
};

/** Sem skin nenhuma — um objeto so, para nao redesenhar a toa. */
export const NO_SKINS = Object.freeze({});

/** O desenho de uma skin, ou null se o app nao a conhece. */
export function skinLook(id) {
  return (id && SKIN_LOOKS[id]) || null;
}

/**
 * As skins em uso, prontas para o desenho: { cap, wings, glasses, necklace },
 * cada uma com o seu desenho. Vem da carteira ({ encaixe: id }); id que o app
 * nao conhece, ou que nao e daquele encaixe, fica de fora.
 */
export function wornSkins(equipped) {
  if (!equipped) return NO_SKINS;
  const worn = {};
  for (const slot of Object.keys(equipped)) {
    const look = skinLook(equipped[slot]);
    if (look && look.slot === slot) worn[slot] = look;
  }
  return Object.keys(worn).length ? worn : NO_SKINS;
}

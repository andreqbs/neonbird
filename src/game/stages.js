/**
 * Fases do jogo.
 *
 * Cada fase e SO uma tabela de numeros e cores: quem desenha (Backdrop, Ground,
 * PillarPair) le daqui, e o World tira daqui a velocidade e o vao. Para criar
 * uma fase nova basta acrescentar um item nesta lista — nao ha `if` de fase
 * espalhado pelo resto do codigo.
 *
 * Regras de progressao (pedido do projeto):
 *   - a cada STAGE_LENGTH obstaculos, a fase troca;
 *   - cada fase corre 10% mais rapido que a velocidade inicial (1.0, 1.1, ...).
 *     O multiplicador e absoluto sobre a velocidade base do layout, e nao
 *     composto, entao a fase 5 e exatamente 40% mais rapida que a fase 1.
 */

export const STAGES = [
  {
    id: 'neon-dusk',
    name: 'Neon Dusk',
    tagline: 'O crepusculo de sempre.',
    speed: 1.0,
    gap: 1.0,
    sky: ['#080C22', '#22164F', '#5B2172', '#B23A6B', '#F2794F'],
    horizon: { color: '#FFB067', opacity: 0.28 },
    city: '#160E33',
    cityFar: '#241852',
    skyline: { topRadius: 3, height: 0.3 },
    star: { color: '#FFFFFF', density: 1 },
    pillar: {
      body: ['#0D8F79', '#2EE6C5', '#A9FFF0', '#2EE6C5', '#0D8F79'],
      cap: ['#A9FFF0', '#2EE6C5', '#0D8F79'],
      capRatio: 0.26,
      capRadius: 0.35,
      bodyRadius: 0.14,
      shine: 0.35,
      rivets: false,
      core: null,
    },
    ground: {
      gradient: ['#131C44', '#0C1230', '#070B1E'],
      line: '#2EE6C5',
      dashA: 'rgba(46,230,197,0.30)',
      dashB: 'rgba(255,213,74,0.18)',
    },
  },

  {
    id: 'cyber-rain',
    name: 'Chuva Ciber',
    tagline: 'Vidro azul e neblina eletrica.',
    speed: 1.1,
    gap: 1.0,
    sky: ['#04121F', '#072A44', '#0B4F6C', '#1B8DA6', '#5FD3D8'],
    horizon: { color: '#7FE6E0', opacity: 0.22 },
    city: '#04212F',
    cityFar: '#0A3346',
    skyline: { topRadius: 1, height: 0.34 }, // torres retas e mais altas
    star: { color: '#CFF7FF', density: 1.35 },
    pillar: {
      body: ['#14497F', '#4FA8FF', '#CFE6FF', '#4FA8FF', '#14497F'],
      cap: ['#CFE6FF', '#4FA8FF', '#14497F'],
      capRatio: 0.3,
      capRadius: 0.1, // topo chanfrado, tipo cristal
      bodyRadius: 0.06,
      shine: 0.5,
      rivets: false,
      core: null,
    },
    ground: {
      gradient: ['#0A2233', '#061826', '#03101A'],
      line: '#4FA8FF',
      dashA: 'rgba(79,168,255,0.32)',
      dashB: 'rgba(207,230,255,0.16)',
    },
  },

  {
    id: 'solar-storm',
    name: 'Tempestade Solar',
    tagline: 'Metal quente e ceu em brasa.',
    speed: 1.2,
    gap: 1.0,
    sky: ['#1A0606', '#3E1108', '#7A2408', '#C24A12', '#F2A03C'],
    horizon: { color: '#FFD27A', opacity: 0.32 },
    city: '#2A0C08',
    cityFar: '#43150B',
    skyline: { topRadius: 2, height: 0.24 },
    star: { color: '#FFE2B0', density: 0.6 },
    pillar: {
      body: ['#A33C08', '#FF8A3D', '#FFD9A8', '#FF8A3D', '#A33C08'],
      cap: ['#FFD9A8', '#FF8A3D', '#A33C08'],
      capRatio: 0.34,
      capRadius: 0.18,
      bodyRadius: 0.1,
      shine: 0.28,
      rivets: true, // faixas escuras no topo, cara de chapa parafusada
      core: null,
    },
    ground: {
      gradient: ['#2A1008', '#1A0A05', '#0D0503'],
      line: '#FF8A3D',
      dashA: 'rgba(255,138,61,0.34)',
      dashB: 'rgba(255,217,168,0.16)',
    },
  },

  {
    id: 'toxic-jungle',
    name: 'Selva Toxica',
    tagline: 'Verde demais para ser saudavel.',
    speed: 1.3,
    gap: 1.0,
    sky: ['#03140C', '#0A2E19', '#14512A', '#2E8F3F', '#8FD64B'],
    horizon: { color: '#C7F06A', opacity: 0.24 },
    city: '#06251A',
    cityFar: '#0C3A26',
    skyline: { topRadius: 999, height: 0.26 }, // topo redondo: virou copa de arvore
    star: { color: '#DFFFC8', density: 0.5 },
    pillar: {
      body: ['#2C7A22', '#7CE04A', '#DBFFB0', '#7CE04A', '#2C7A22'],
      cap: ['#DBFFB0', '#7CE04A', '#2C7A22'],
      capRatio: 0.28,
      capRadius: 0.5, // topo totalmente arredondado, organico
      bodyRadius: 0.3,
      shine: 0.22,
      rivets: false,
      core: null,
    },
    ground: {
      gradient: ['#0B2A18', '#071B0F', '#030E07'],
      line: '#7CE04A',
      dashA: 'rgba(124,224,74,0.32)',
      dashB: 'rgba(219,255,176,0.16)',
    },
  },

  {
    id: 'void-circuit',
    name: 'Circuito Vazio',
    tagline: 'So voce, o vazio e o magenta.',
    speed: 1.4,
    gap: 1.0,
    sky: ['#05030C', '#170729', '#360B4A', '#661056', '#B3226B'],
    horizon: { color: '#FF5FA8', opacity: 0.22 },
    city: '#120424',
    cityFar: '#230A3A',
    skyline: { topRadius: 1, height: 0.2 },
    star: { color: '#FFD9F2', density: 1.6 },
    pillar: {
      body: ['#8A0F6E', '#FF4FD8', '#FFC7F2', '#FF4FD8', '#8A0F6E'],
      cap: ['#FFC7F2', '#FF4FD8', '#8A0F6E'],
      capRatio: 0.22,
      capRadius: 0.5,
      bodyRadius: 0.08,
      shine: 0.4,
      rivets: false,
      core: '#FFFFFF', // nucleo brilhante correndo pelo meio da coluna
    },
    ground: {
      gradient: ['#1A0A2A', '#0E0518', '#05020A'],
      line: '#FF4FD8',
      dashA: 'rgba(255,79,216,0.34)',
      dashB: 'rgba(255,199,242,0.16)',
    },
  },
];

export const STAGE_COUNT = STAGES.length;

/** Fase de um indice qualquer, presa na ultima quando o jogador passa dela. */
export function stageAt(index) {
  if (!Number.isFinite(index)) return STAGES[0];
  return STAGES[Math.min(Math.max(Math.floor(index), 0), STAGES.length - 1)];
}

/** Numero da fase para mostrar na tela (1..N, sem travar na ultima). */
export function stageNumber(index) {
  return Math.max(0, Math.floor(index)) + 1;
}

import { theme } from '../ui/theme';

/**
 * A aparencia de cada passaro.
 *
 * So o DESENHO mora aqui: nome, preco e habilidade vem do servidor
 * (server/catalog.go). Passaro que o servidor mande e o app ainda nao conheca
 * aparece com a cara do de sempre — a loja nunca quebra por causa disso.
 *
 * Cada entrada e so cor e acessorio; quem desenha e o BirdFigure, com View sobre
 * View, como o passaro original. Nenhuma imagem: escala em qualquer tela.
 *
 *   body / deep / wing / belly / beak  as cores do corpo
 *   glow                               o halo em volta durante o voo
 *   crest                              topete: crystals | flame | antenna
 *   mask                               faixa sobre os olhos
 *   visor                              visor no lugar do olho
 *   tail                               rastro atras do corpo (duas cores)
 *   bodyOpacity                        corpo meio transparente
 */
export const BIRD_LOOKS = {
  classic: {
    body: theme.bird,
    deep: theme.birdDeep,
    wing: theme.birdWing,
    belly: '#FFF0B8',
    beak: theme.beak,
    glow: theme.bird,
  },

  // Geada: azul-gelo, cristais no topo, asa quase branca.
  frost: {
    body: '#9BE7FF',
    deep: '#3C9FD1',
    wing: '#E6FAFF',
    belly: '#FFFFFF',
    beak: '#FFB36B',
    glow: '#8FF7FF',
    crest: { kind: 'crystals', color: '#E6FAFF', edge: '#3C9FD1' },
  },

  // Brasa: vermelho-laranja com um topete de tres chamas.
  ember: {
    body: '#FF6A3D',
    deep: '#B8300F',
    wing: '#FFB02E',
    belly: '#FFD9A8',
    beak: '#4A1A10',
    glow: '#FF8A3D',
    crest: { kind: 'flame', colors: ['#FF3B1F', '#FFB02E', '#FFE45C'] },
  },

  // Toxina: verde neon, mascara roxa e antena.
  toxic: {
    body: '#86F04F',
    deep: '#2E8F22',
    wing: '#C8FF6E',
    belly: '#EAFFCF',
    beak: '#B04BFF',
    glow: '#7CE04A',
    mask: '#6B2BD4',
    crest: { kind: 'antenna', color: '#C8FF6E', tip: '#B04BFF' },
  },

  // Fantasma: lilas meio transparente, com visor ciano no lugar do olho.
  phantom: {
    body: '#B8A8FF',
    deep: '#6A4BD6',
    wing: '#EDE7FF',
    belly: '#FFFFFF',
    beak: '#8C7BE0',
    glow: '#C9B8FF',
    bodyOpacity: 0.88,
    visor: '#5FF6FF',
  },

  // Cometa: branco, asa ciano e um rastro ciano e magenta.
  comet: {
    body: '#F4F7FF',
    deep: '#8E9CD0',
    wing: '#6FD8FF',
    belly: '#FFFFFF',
    beak: '#FF4FD8',
    glow: '#BFEFFF',
    tail: ['#5FD3FF', '#FF4FD8'],
  },
};

export const DEFAULT_BIRD = 'classic';

export function lookFor(birdId) {
  return BIRD_LOOKS[birdId] || BIRD_LOOKS[DEFAULT_BIRD];
}

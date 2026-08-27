const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// O que realmente define a dificuldade e a razao entre o vao e o tamanho do
// passaro. Mantendo essa razao fixa, o jogo tem exatamente o mesmo aperto num
// celular pequeno em retrato e num tablet em paisagem.
const GAP_TO_BIRD = 5.5;

// Altura que um unico toque ganha, como fracao do vao.
const FLAP_RISE = 0.48;

/**
 * Calcula todas as medidas do jogo a partir do tamanho real da area de jogo.
 * Tudo e derivado, entao o mesmo codigo serve para retrato e paisagem,
 * em celular ou tablet, sem numeros magicos espalhados pelo projeto.
 */
export function computeLayout(width, height) {
  const landscape = width >= height;

  const groundHeight = clamp(height * (landscape ? 0.12 : 0.14), 44, 140);
  const playHeight = height - groundHeight;

  // 1. O vao vem primeiro. Em paisagem sobra pouca altura, entao ele precisa
  //    ocupar uma fatia proporcionalmente maior da tela.
  const gap = clamp(playHeight * (landscape ? 0.4 : 0.31), 84, playHeight * 0.5);
  const gapMin = gap * 0.86; // vao no nivel maximo de dificuldade

  // 2. O passaro e derivado do vao, nao da tela.
  const birdRadius = clamp(gap / (GAP_TO_BIRD * 2), 8, 30);
  const birdX = width * (landscape ? 0.24 : 0.28);

  // 3. As colunas acompanham o passaro na largura.
  const pillarWidth = clamp(birdRadius * 3.4, 30, 110);

  // Velocidade em px por frame: proporcional a largura, entao uma coluna leva
  // sempre ~3,2 s para atravessar a tela, em qualquer aparelho.
  const speed = width / 190;
  const spacing = clamp(
    width * (landscape ? 0.58 : 0.66),
    pillarWidth * 3.4,
    width * 0.92
  );

  // Gravidade em px/frame^2. O impulso do toque e derivado dela e do vao,
  // entao o "peso" do passaro e identico em qualquer resolucao.
  const gravity = playHeight * 0.00078;
  const flapVelocity = -Math.sqrt(2 * gravity * gap * FLAP_RISE);
  const maxFall = Math.abs(flapVelocity) * 1.7;

  // Folga no topo e no chao para o centro do vao nunca encostar nas bordas.
  const marginY = clamp(playHeight * 0.1, birdRadius * 1.6, (playHeight - gap) / 2);
  const pillarCount = Math.ceil(width / spacing) + 2;

  return {
    width,
    height,
    landscape,
    groundHeight,
    playHeight,
    birdRadius,
    birdX,
    gap,
    gapMin,
    pillarWidth,
    spacing,
    speed,
    gravity,
    flapVelocity,
    maxFall,
    marginY,
    pillarCount,
  };
}

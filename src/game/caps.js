/**
 * A tampa do cano: a ponta mais larga, virada para o vao.
 *
 * O desenho (PillarPair) e a fisica (World) usam estas mesmas medidas — a tampa
 * que aparece na tela e a que derruba o passaro nao podem ter tamanhos
 * diferentes. Ela passa 9% da largura do cano para cada lado, tem `capRatio` da
 * largura de altura (no minimo 14 px) e cantos arredondados em `capRadius` da
 * altura — os dois numeros vem da tabela da fase (stages.js).
 */

export const CAP_WIDTH = 1.18;
export const CAP_MIN_HEIGHT = 14;

export function capShape(pillarWidth, look) {
  const width = pillarWidth * CAP_WIDTH;
  const height = Math.max(CAP_MIN_HEIGHT, pillarWidth * look.capRatio);
  const radius = Math.min(height * look.capRadius, height / 2, width / 2);
  return { width, height, radius };
}

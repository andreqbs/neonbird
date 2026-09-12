/**
 * Onde as moedas aparecem.
 *
 * Nada aqui e sorteio do aparelho. No inicio de cada partida o SERVIDOR sorteia
 * uma semente, e a partir dela esta conta decide, obstaculo por obstaculo, se
 * ali tem moeda e em que altura do vao ela fica. O servidor faz a MESMA conta
 * (server/coins.go) ao fechar a partida — entao ele sabe exatamente quais
 * moedas existiam e recusa qualquer "moeda" que o app diga ter pego fora delas.
 *
 * Por isso a conta e inteira e em 32 bits, com `Math.imul` e `>>> 0`: e o que
 * garante o mesmo resultado bit a bit em JavaScript e em Go. Os valores de
 * referencia estao nos testes dos dois lados.
 */

/** Quanto do vao a moeda pode ocupar: centro, com ate 22% para cima ou para baixo. */
export const COIN_SPREAD = 0.44;

/** Raio da moeda, em fracao do raio do passaro. */
export const COIN_RADIUS = 0.5;

/** Embaralhador de 32 bits (mesmo algoritmo em server/coins.go). */
export function mix32(value) {
  let x = value >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** O numero que decide a moeda do obstaculo `ordinal` (1, 2, 3...). */
export function coinRoll(seed, ordinal) {
  return mix32((seed ^ Math.imul(ordinal, 0x9e3779b9)) >>> 0);
}

/**
 * Este obstaculo tem moeda? `every` vem do servidor junto com a semente (hoje,
 * 3: uma moeda a cada tres obstaculos, em media).
 *
 * Sem semente — partida de treino, sem internet — nunca ha moeda.
 */
export function hasCoin(seed, ordinal, every) {
  if (seed === null || seed === undefined || !(every >= 1) || !(ordinal >= 1)) return false;
  return coinRoll(seed, ordinal) % every === 0;
}

/**
 * Altura da moeda dentro do vao, de 0 (em cima) a 1 (embaixo). So o desenho usa:
 * o servidor nao precisa saber a altura para conferir se a moeda existia.
 */
export function coinOffset(seed, ordinal) {
  return ((coinRoll(seed, ordinal) >>> 8) % 1000) / 1000;
}

/**
 * Onde as moedas aparecem.
 *
 * Nada aqui e sorteio do aparelho. No inicio de cada partida o SERVIDOR sorteia
 * uma semente, e a partir dela esta conta decide, obstaculo por obstaculo, se
 * ali tem moedas e em que altura do vao elas ficam. O servidor faz a MESMA conta
 * (server/coins.go) ao fechar a partida — entao ele sabe exatamente quais
 * moedas existiam e recusa qualquer "moeda" que o app diga ter pego fora delas.
 *
 * Por isso a conta e inteira e em 32 bits, com `Math.imul` e `>>> 0`: e o que
 * garante o mesmo resultado bit a bit em JavaScript e em Go. Os valores de
 * referencia estao nos testes dos dois lados.
 *
 * LETRAS: o obstaculo que tem moedas traz uma LETRA feita de moedas, na ordem de
 * COIN_WORD — M, A, J, O, R, F, L, Y, E, R e de novo do M. Cada fase recomeca do
 * M. Cada moeda da letra vale uma moeda na carteira; o app manda o numero do
 * obstaculo uma vez para cada moeda pega, e o servidor aceita ate o tamanho da
 * letra daquele obstaculo.
 */

/** A palavra que as moedas escrevem, uma letra por obstaculo com moedas. */
export const COIN_WORD = ['M', 'A', 'J', 'O', 'R', 'F', 'L', 'Y', 'E', 'R'];

/**
 * O desenho de cada letra: 5 linhas, X = moeda. As moedas sao numeradas linha a
 * linha, da esquerda para a direita — o servidor so usa o TOTAL de cada letra
 * (server/coins.go tem o mesmo desenho). Mexeu aqui, mexe la.
 */
export const LETTER_ROWS = {
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
  A: ['.XX.', 'X..X', 'XXXX', 'X..X', 'X..X'],
  J: ['...X', '...X', '...X', 'X..X', '.XX.'],
  O: ['.XX.', 'X..X', 'X..X', 'X..X', '.XX.'],
  R: ['XXX.', 'X..X', 'XXX.', 'X.X.', 'X..X'],
  F: ['XXXX', 'X...', 'XXX.', 'X...', 'X...'],
  L: ['X...', 'X...', 'X...', 'X...', 'XXXX'],
  Y: ['X...X', '.X.X.', '..X..', '..X..', '..X..'],
  E: ['XXXX', 'X...', 'XXX.', 'X...', 'XXXX'],
};

/**
 * As moedas de uma letra, em "passos" a partir do centro dela: `col` de -2 a 2
 * e `row` de -2 a 2. Quem desenha multiplica pelo espaco entre as moedas.
 */
export const LETTER_PIECES = Object.fromEntries(
  Object.entries(LETTER_ROWS).map(([letra, linhas]) => {
    const pecas = [];
    linhas.forEach((linha, r) => {
      for (let c = 0; c < linha.length; c++) {
        if (linha[c] === 'X') pecas.push({ col: c - (linha.length - 1) / 2, row: r - (linhas.length - 1) / 2 });
      }
    });
    return [letra, pecas];
  })
);

/** A letra com mais moedas (o M e o E, com 13). */
export const MAX_LETTER_COINS = Math.max(...Object.values(LETTER_PIECES).map((p) => p.length));

/** Linhas de cada letra — todas tem a mesma altura. */
export const LETTER_ROW_COUNT = 5;

/** Distancia entre os centros de duas moedas vizinhas da letra, em raios de moeda. */
export const LETTER_PITCH = 2.3;

/**
 * Raio da moeda, em fracao do raio do passaro. Era 0,5 e subiu 10% junto com o
 * zoom out do retrato (layout.js), que deixou tudo menor na tela.
 */
export const COIN_RADIUS = 0.55;

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
 * Altura da letra dentro do vao, de 0 (em cima) a 1 (embaixo). So o desenho usa:
 * o servidor nao precisa saber a altura para conferir se a moeda existia.
 */
export function coinOffset(seed, ordinal) {
  return ((coinRoll(seed, ordinal) >>> 8) % 1000) / 1000;
}

/**
 * A letra que o obstaculo `ordinal` traz — ou null, se ali nao tem moeda.
 *
 * E a posicao dele entre os obstaculos COM moeda da mesma fase: o primeiro da
 * fase traz o M, o segundo o A, e assim por diante. `stageLength` e o tamanho
 * da fase (STAGE_LENGTH): a fase nova recomeca do M.
 */
export function coinLetterAt(seed, ordinal, every, stageLength) {
  if (!hasCoin(seed, ordinal, every)) return null;
  const inicio = Math.floor((ordinal - 1) / stageLength) * stageLength;
  let antes = 0;
  for (let o = inicio + 1; o < ordinal; o++) {
    if (hasCoin(seed, o, every)) antes++;
  }
  return COIN_WORD[antes % COIN_WORD.length];
}

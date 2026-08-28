import { PHASE } from './constants';

/**
 * Continuidade da partida entre orientacoes.
 *
 * Girar o aparelho muda a largura, a altura, o vao, o tamanho do passaro e a
 * posicao de todas as colunas — nao da para "converter" o mundo antigo, ele e
 * refeito. O que atravessa a virada e o placar: o jogador nao deveria perder a
 * partida por ter mudado o jeito de segurar o celular.
 *
 * Depois de restaurar, o mundo fica em READY: o jogador retoma quando tocar,
 * sem cair de surpresa numa tela que acabou de mudar de forma.
 */

export const EMPTY_SESSION = { score: 0, live: false };

/** Instantaneo do que precisa sobreviver a uma remontagem. */
export function captureSession(world) {
  return {
    score: world.score,
    // Uma partida "viva" e a que esta rolando, ou a que ja foi retomada uma vez
    // e ainda espera o toque. Depois de perder (OVER) nao ha o que carregar.
    // Girar durante a tela de fim de fase tambem conta: o placar e a fase
    // seguem, so o anuncio daquela troca e que fica para tras.
    live:
      world.phase === PHASE.PLAYING ||
      world.phase === PHASE.STAGE_CLEAR ||
      (world.phase === PHASE.READY && world.score > 0),
  };
}

/**
 * Devolve o placar a um mundo recem-criado.
 * Retorna `true` quando havia mesmo uma partida para retomar.
 */
export function restoreSession(world, session) {
  if (!session || !session.live || !(session.score > 0)) return false;
  world.score = session.score;
  // A fase nao precisa viajar no pacote: ela E o placar dividido pelo tamanho
  // da fase. Derivar evita o pior caso — girar o aparelho na tela de fim de
  // fase e voltar com o alvo ja batido, fechando fase a cada ponto.
  world.syncStageToScore();
  return true;
}

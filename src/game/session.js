import { PHASE } from './constants';

/**
 * Continuidade da partida entre orientacoes.
 *
 * Girar o aparelho muda a largura, a altura, o vao, o tamanho do passaro e a
 * posicao de todas as colunas — nao da para "converter" o mundo antigo, ele e
 * refeito. O que atravessa a virada e o PROGRESSO: placar, moedas pegas (e de
 * quais obstaculos, que e o que vai para o servidor) e as novas chances usadas.
 * O jogador nao deveria perder nada por ter mudado o jeito de segurar o celular.
 *
 * Dois casos:
 *   - partida viva: o mundo novo fica em READY e o jogador retoma quando tocar,
 *     sem cair de surpresa numa tela que acabou de mudar de forma;
 *   - partida perdida mas ainda nao encerrada: o mundo novo volta DERRUBADO,
 *     com o placar — senao girar a tela na oferta de nova chance apagaria a
 *     partida que o servidor ainda considera aberta.
 */

export const EMPTY_SESSION = {
  score: 0,
  coins: 0,
  coinOrdinals: [],
  continuesUsed: 0,
  shield: false,
  live: false,
  over: false,
};

/** Instantaneo do que precisa sobreviver a uma remontagem. */
export function captureSession(world) {
  return {
    score: world.score,
    coins: world.coins,
    coinOrdinals: world.coinOrdinals.slice(),
    continuesUsed: world.continuesUsed,
    // Escudo inteiro atravessa a virada: ele foi pago no servidor. O que ja
    // esta se dissipando nao — a batida que o gastou ficou no mundo antigo.
    shield: Boolean(world.shield && !world.shieldFading),
    // Uma partida "viva" e a que esta rolando, ou a que ja foi retomada uma vez
    // e ainda espera o toque. Girar durante a tela de fim de fase tambem conta:
    // o placar e a fase seguem.
    live:
      world.phase === PHASE.PLAYING ||
      world.phase === PHASE.STAGE_CLEAR ||
      (world.phase === PHASE.READY && (world.score > 0 || world.coins > 0)),
    over: world.phase === PHASE.OVER,
  };
}

/**
 * Devolve a partida a um mundo recem-criado.
 *
 * Retorna 'live' (voo retomado), 'over' (de volta a tela de fim, com o placar)
 * ou null (nada a retomar).
 */
export function restoreSession(world, session) {
  if (!session) return null;

  if (session.over) {
    world.restoreProgress(session);
    world.dropToFloor();
    return 'over';
  }

  if (!session.live || !(session.score > 0 || session.coins > 0)) return null;
  // A fase nao precisa viajar no pacote: ela E o placar dividido pelo tamanho
  // da fase. Derivar evita o pior caso — girar o aparelho na tela de fim de
  // fase e voltar com o alvo ja batido, fechando fase a cada ponto.
  world.restoreProgress(session);
  return 'live';
}

/**
 * A conta da tela de carregamento (LoadingScreen): quanto da barra encher, que
 * frase mostrar e quando sair. Conta pura, sem React — o `npm test` passa por
 * ela.
 *
 * A abertura espera quatro coisas:
 *   settings  as preferencias, do disco (idioma e som)
 *   player    o jogador deste aparelho, do disco (ou criado agora)
 *   server    carteira e catalogo, do servidor — ou a certeza de que nao ha
 *             servidor (sem internet): ai a Home abre no modo treino
 *   home      a Home ja medida e desenhada no tamanho da tela
 *
 * Cada uma vale uma fatia da barra. O servidor e o unico passo demorado e o
 * unico sem como saber quanto falta: enquanto ele nao responde, a barra anda
 * sozinha dentro da fatia dele, cada vez mais devagar, sem nunca completa-la —
 * quem completa e a resposta.
 */

export const BOOT_WEIGHTS = { settings: 0.1, player: 0.1, server: 0.65, home: 0.15 };

/** Ate onde a barra anda sozinha na fatia do servidor (fracao dela). */
const CREEP_MAX = 0.9;
/** Quanto tempo a barra leva para andar ~63% desse trecho. */
const CREEP_MS = 2500;

/** Menos que isso a tela nem chega a ser lida: vira um piscar. */
export const BOOT_MIN_MS = 500;

/** A partir daqui a frase avisa que o servidor esta demorando. */
export const BOOT_SLOW_MS = 3500;

/**
 * O teto da espera. Passou disso, a Home abre de qualquer jeito — com o botao
 * em "Conectando..." se o servidor ainda nao respondeu — e continua esperando a
 * resposta la. A tela de carregamento nunca prende ninguem.
 */
export const BOOT_MAX_MS = 8000;

/** A fracao da barra (0 a 1). `done`: o que ja chegou; `elapsed`: ms desde a abertura. */
export function bootProgress(done, elapsed) {
  let fracao = 0;
  if (done.settings) fracao += BOOT_WEIGHTS.settings;
  if (done.player) fracao += BOOT_WEIGHTS.player;
  if (done.home) fracao += BOOT_WEIGHTS.home;
  if (done.server) fracao += BOOT_WEIGHTS.server;
  else fracao += BOOT_WEIGHTS.server * CREEP_MAX * (1 - Math.exp(-Math.max(0, elapsed) / CREEP_MS));
  return Math.min(1, fracao);
}

/**
 * A frase da vez (a chave em `boot.*` dos arquivos de idioma): o primeiro passo
 * que falta, ou — tudo pronto — se a Home abre normal ou no modo treino.
 */
export function bootStep(done, elapsed) {
  if (!done.settings) return 'settings';
  if (!done.player) return 'player';
  if (!done.server) return elapsed >= BOOT_SLOW_MS ? 'slow' : 'server';
  if (!done.home) return 'menu';
  return done.offline ? 'offline' : 'ready';
}

/** Se ja e hora de sair: tudo pronto (e o minimo de tela cumprido), ou o teto. */
export function bootFinished(done, elapsed) {
  if (elapsed >= BOOT_MAX_MS) return true;
  if (elapsed < BOOT_MIN_MS) return false;
  return Boolean(done.settings && done.player && done.server && done.home);
}

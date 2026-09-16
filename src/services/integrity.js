import { sha256Hex } from './sha256';

/**
 * A prova de que a partida foi jogada no app de verdade, num aparelho de verdade
 * (Play Integrity, do Google Play).
 *
 * Quando a partida rende alguma coisa, o app pede ao Google um token amarrado
 * aos dados do fechamento — placar, moedas e tempo de voo — e manda junto, no
 * cabecalho X-Integrity-Token. O servidor abre o token no Google e so credita se
 * ele disser que e o app original, sem nada controlando a tela por cima
 * (server/integrity.go).
 *
 * ----------------------------------------------------------------------------
 * PARA LIGAR: escreva o NUMERO do seu projeto do Google Cloud em
 * `DEFAULT_CLOUD_PROJECT_NUMBER`, aqui embaixo (o mesmo projeto vinculado ao app
 * no Play Console). Quem preferir nao mexer no codigo pode deixar
 * `EXPO_PUBLIC_CLOUD_PROJECT_NUMBER` no `.env` da raiz. Ver server/README.md.
 * ----------------------------------------------------------------------------
 *
 * SEM NUMERO, o app nao pede token e joga igual: quem decide o que fazer com uma
 * partida sem prova e o servidor (INTEGRITY_MODE).
 *
 * TAMBEM NAO PEDE: no modo de desenvolvimento (build de dev nao e reconhecida
 * pela Play Store, o veredito sairia reprovado de qualquer jeito), fora do
 * Android, e em partida que nao rendeu nada.
 */

/** O NUMERO do projeto do Google Cloud (so digitos), nao o id nem o nome. */
export const DEFAULT_CLOUD_PROJECT_NUMBER = '';

const CLOUD_PROJECT_NUMBER = String(
  process.env.EXPO_PUBLIC_CLOUD_PROJECT_NUMBER || DEFAULT_CLOUD_PROJECT_NUMBER
).trim();

/**
 * Quanto o fechamento espera pelo token. O Google responde em menos de um
 * segundo quando o provedor ja esta preparado; passou disso, a partida sobe sem
 * a prova em vez de deixar o jogador olhando para uma tela parada.
 */
const TOKEN_TIMEOUT_MS = 12000;

let projectNumber = CLOUD_PROJECT_NUMBER;
let provider; // undefined = ainda nao procurei; null = nao ha
let prepared = false;
let preparing = null;

/** O modulo nativo, procurado uma vez so. Null quando nao ha token a pedir. */
function nativeProvider() {
  if (provider !== undefined) return provider;
  provider = null;
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return provider;
    const { Platform } = require('react-native');
    // No iPhone a prova equivalente e o App Attest, outra conversa — e o
    // servidor ainda nao a fala.
    if (Platform.OS !== 'android') return provider;
    provider = require('@expo/app-integrity');
  } catch (e) {
    // App sem o modulo nativo (build antiga, Expo Go): joga sem prova.
    provider = null;
  }
  return provider;
}

/** So para os testes: troca o modulo nativo por um dublê. Sem argumento, volta ao normal. */
export function __setProvider(fake, numero = '1234567890') {
  provider = fake === undefined ? undefined : fake;
  projectNumber = fake === undefined ? CLOUD_PROJECT_NUMBER : String(numero);
  prepared = false;
  preparing = null;
}

/** Se este aparelho tem como provar alguma coisa. */
export function isEnabled() {
  return Boolean(projectNumber && nativeProvider());
}

/**
 * Prepara o pedido de token com o Google. E a parte demorada — alguns segundos
 * na primeira vez —, por isso o app chama isto na abertura: no fim da partida o
 * token ja sai na hora.
 *
 * Nunca levanta excecao: devolve false quando nao deu, e o jogo segue.
 */
export function prepare() {
  const mod = nativeProvider();
  if (!mod || !projectNumber) return Promise.resolve(false);
  if (prepared) return Promise.resolve(true);
  if (!preparing) {
    preparing = mod
      .prepareIntegrityTokenProviderAsync(projectNumber)
      .then(() => {
        prepared = true;
        return true;
      })
      .catch(() => false)
      .then((ok) => {
        preparing = null;
        return ok;
      });
  }
  return preparing;
}

/**
 * O token deste fechamento, ou null quando nao da para provar nada: sem modulo,
 * sem numero do projeto, sem Play Store no aparelho, Google fora do ar.
 *
 * O jogo nunca para por causa disso — manda o fechamento sem a prova e deixa o
 * servidor decidir.
 */
export async function tokenFor(requestHash, { timeoutMs = TOKEN_TIMEOUT_MS } = {}) {
  const mod = nativeProvider();
  if (!mod || !projectNumber || !requestHash) return null;

  let relogio;
  const prazo = new Promise((resolve) => {
    relogio = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([pedeToken(mod, requestHash), prazo]);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

async function pedeToken(mod, requestHash) {
  // Duas tentativas: o provedor vence de tempos em tempos e o Google manda
  // prepara-lo de novo. Falhou as duas, a partida sobe sem prova.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (!(await prepare())) return null;
    try {
      const token = await mod.requestIntegrityCheckAsync(requestHash);
      if (token) return token;
    } catch (e) {
      // segue para a proxima tentativa
    }
    prepared = false;
  }
  return null;
}

/**
 * O resumo dos dados do fechamento — a mesma conta do `FinishHash` do servidor
 * (server/integrity.go), conferida pelos dois testes com os mesmos valores.
 *
 * E ele que amarra a prova a ESTA partida: mudar o placar depois de pedir o
 * token invalida a prova.
 */
export function finishHash(runId, { points, coinOrdinals, flightMs }) {
  const moedas = Array.isArray(coinOrdinals) ? coinOrdinals.join(',') : '';
  return sha256Hex(`finish|${runId}|${points}|${flightMs}|${moedas}`);
}

export default { isEnabled, prepare, tokenFor, finishHash };

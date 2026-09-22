import { isConfigured, request, requestRegistered } from './cloud';
import { initPlayer } from './identity';
import integrity from './integrity';

/**
 * A economia do jogo vista pelo app: moedas, vidas, escudos, novas chances e
 * passaros — e as partidas abertas no servidor.
 *
 * NADA DAQUI VAI PARA O DISCO. O servidor e a unica fonte da verdade; este
 * modulo guarda na MEMORIA so a ultima resposta dele, para a tela desenhar sem
 * esperar rede a cada render. Fechou o app, esqueceu — e na proxima abertura
 * pergunta de novo. E o que impede alguem de editar um arquivo do aparelho e
 * aparecer com dez mil moedas.
 *
 * Tambem nao ha conta feita aqui: nem para adiantar o numero na tela. Toda
 * resposta que muda saldo traz a carteira inteira, e e ela que vale.
 *
 * Mesmo desenho de identity.js: estado na memoria, `subscribeEconomy` para quem
 * precisa redesenhar, e funcoes que nunca levantam excecao — devolvem
 * `{ ok, error, code, offline, ... }`.
 *
 * status:
 *   'idle'     ainda nao perguntou nada
 *   'loading'  perguntando
 *   'ready'    carteira e catalogo em maos
 *   'offline'  sem servidor (sem internet ou sem endereco): so o modo treino
 */

let state = { status: 'idle', wallet: null, catalog: null, error: null };
const listeners = new Set();
let refreshing = null;

/**
 * Fechamentos de partida que nao chegaram ao servidor por falta de rede. Ficam
 * so na memoria, enquanto o app estiver aberto: guardar no disco seria
 * justamente registrar moeda no aparelho.
 */
const pendingFinishes = new Map();

function update(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function economyNow() {
  return state;
}

export function subscribeEconomy(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A carteira que veio numa resposta substitui a da tela. */
function absorb(result) {
  if (result.ok && result.data && result.data.wallet) {
    update({ wallet: result.data.wallet, status: 'ready', error: null });
  } else if (result.offline) {
    update({ status: 'offline', error: result.error });
  }
  return result;
}

// ----------------------------------------------------------------- consultas

/**
 * Busca carteira e catalogo. Chamadas repetidas enquanto uma esta em curso
 * esperam a mesma resposta.
 */
export function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      if (!isConfigured()) {
        update({ status: 'offline', error: 'offline' });
        return false;
      }
      await initPlayer().catch(() => {});
      if (state.status !== 'ready') update({ status: 'loading' });

      const [catalogo, carteira] = await Promise.all([
        state.catalog
          ? Promise.resolve({ ok: true, data: state.catalog })
          : request('GET', '/v1/catalog', { auth: false }),
        requestRegistered('GET', '/v1/me/wallet'),
      ]);

      if (catalogo.ok && carteira.ok) {
        update({ status: 'ready', catalog: catalogo.data, wallet: carteira.data.wallet, error: null });
        flushFinishes();
        return true;
      }
      const falha = carteira.ok ? catalogo : carteira;
      // Sem servidor utilizavel, o jogo so tem o treino a oferecer — seja por
      // falta de rede, seja por uma recusa que o app nao sabe contornar.
      update({ status: 'offline', error: falha.error });
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function birdById(id) {
  const birds = state.catalog && state.catalog.birds;
  return (birds && birds.find((b) => b.id === id)) || null;
}

/** Preco de 'shield' ou 'continue', em moedas. Null antes do catalogo chegar. */
export function priceOf(item) {
  const offer = state.catalog && state.catalog.items && state.catalog.items[item];
  return offer ? offer.price : null;
}

// ------------------------------------------------------------------ partidas

/**
 * Abre uma partida no servidor. Ele desconta a vida e sorteia a semente das
 * moedas; o app so comeca a voar com a resposta na mao.
 */
export async function startRun() {
  // Fechamento atrasado vai antes: abrir a partida nova abandona a antiga, e as
  // moedas dela se perderiam.
  await flushFinishes();
  const r = absorb(await requestRegistered('POST', '/v1/runs/start'));
  if (r.ok) return { ok: true, run: r.data.run };
  // Sem vidas: busca a carteira de verdade para a tela oferecer o video.
  if (r.code === 'no_lives') refresh();
  return r;
}

/**
 * Fecha a partida mandando o placar, os NUMEROS dos obstaculos das moedas pegas
 * e o tempo de voo (so o tempo voando de fato, em ms). O servidor confere cada
 * moeda e devolve o que foi creditado.
 *
 * Repetir e seguro (`retry`): partida ja fechada devolve o mesmo resultado e nao
 * paga de novo. Se a resposta da primeira tentativa se perder no caminho, a
 * segunda ainda traz as moedas certas.
 */
export async function finishRun(runId, { points, coinOrdinals, flightMs }) {
  const payload = {
    points: Math.max(0, Math.floor(points || 0)),
    coinOrdinals: Array.isArray(coinOrdinals) ? coinOrdinals.slice() : [],
    flightMs: Math.max(0, Math.round(flightMs || 0)),
  };
  const r = await sendFinish(runId, payload);
  if (r.ok) {
    pendingFinishes.delete(runId);
    return { ok: true, result: r.data.result };
  }
  if (r.offline) pendingFinishes.set(runId, payload);
  return r;
}

/**
 * Manda o fechamento ao servidor. Partida que rendeu alguma coisa leva junto a
 * prova de integridade DESTE placar (integrity.js).
 *
 * A prova e pedida na hora do envio, inclusive no fechamento guardado que sobe
 * mais tarde: token velho nao vale, e partida que nao rendeu nada nao gasta
 * verificacao nenhuma.
 */
async function sendFinish(runId, payload) {
  const options = { body: payload, retry: true };
  if (payload.points > 0 || payload.coinOrdinals.length > 0) {
    const token = await integrity.tokenFor(integrity.finishHash(runId, payload));
    if (token) options.headers = { 'X-Integrity-Token': token };
  }
  return absorb(await requestRegistered('POST', `/v1/runs/${runId}/finish`, options));
}

async function flushFinishes() {
  for (const [runId, payload] of [...pendingFinishes]) {
    const r = await sendFinish(runId, payload);
    if (r.ok || !r.offline) pendingFinishes.delete(runId);
  }
}

/** Nova chance: `method` e 'stock' (guardada) ou 'coins'. */
export async function continueRun(runId, method) {
  const r = absorb(
    await requestRegistered('POST', `/v1/runs/${runId}/continue`, { body: { method } })
  );
  return r.ok ? { ok: true, continuesUsed: r.data.continuesUsed } : r;
}

/** Gasta um escudo guardado na partida aberta. */
export async function useShield(runId) {
  const r = absorb(await requestRegistered('POST', `/v1/runs/${runId}/shield`));
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------------- loja

/** Compra 'bird' (com `birdId`), 'shield' ou 'continue'. */
export async function buy(item, birdId) {
  const body = item === 'bird' ? { item, birdId } : { item };
  return absorb(await requestRegistered('POST', '/v1/shop/buy', { body }));
}

/**
 * Troca uma compra com dinheiro (Google Play) pelo passaro dela — quem confere o
 * pagamento com o Google e o servidor (server/billing.go). Repetir e seguro: a
 * mesma compra devolve a mesma carteira. Pagamento ainda pendente volta com
 * `pending`.
 */
export async function claimBirdPurchase(birdId, purchaseToken) {
  const r = absorb(
    await requestRegistered('POST', '/v1/shop/purchase', { body: { birdId, purchaseToken }, retry: true })
  );
  if (r.ok && r.status === 202) return { ok: false, pending: true };
  return r;
}

/** Escolhe o passaro das proximas partidas. */
export async function equip(birdId) {
  return absorb(await requestRegistered('POST', '/v1/me/bird', { body: { birdId } }));
}

// ------------------------------------------------------------------ anuncios

/**
 * Espera entre as tentativas de trocar o video pelo premio. O aviso do Google
 * chega ao servidor alguns instantes depois de o video fechar; ~25 s no total
 * cobre a demora normal sem deixar ninguem olhando para uma tela parada.
 */
export const CLAIM_DELAYS_MS = [800, 1200, 1500, 2000, 2500, 3000, 3000, 4000, 4000, 4000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * O que o jogador le quando o video nao vira premio.
 *
 * Na build da loja, sem bastidor: nem Google nem servidor — so que o premio nao
 * saiu e que da para tentar de novo. O texto do anuncio de teste e para quem
 * desenvolve, e so aparece la (ver `testAd` abaixo).
 */
export const CLAIM_MESSAGES = {
  production: 'Não deu para liberar seu prêmio agora. Tente de novo em alguns instantes.',
  testAd:
    'Anúncio de teste não é confirmado pelo Google. Para testar prêmios, use um servidor com ADS_DEV_AUTOVERIFY=true.',
};

/**
 * Troca um video premiado confirmado pelo premio: 'lives', 'shield' ou
 * 'continue'. So devolve ok com o premio ja registrado no servidor.
 *
 * `testAd`: o video era de teste ou simulado (desenvolvimento). Esse video nunca
 * gera o aviso do Google, entao so um servidor de desenvolvimento
 * (ADS_DEV_AUTOVERIFY=true) libera o premio — e ele responde na primeira
 * tentativa. Com anuncio de teste a troca e tentada uma vez so: esperar os ~25 s
 * nao mudaria o resultado.
 */
export async function claimAd(kind, { delays = CLAIM_DELAYS_MS, wait = sleep, testAd = false } = {}) {
  const esperas = testAd ? [] : delays;
  for (let tentativa = 0; ; tentativa++) {
    const r = absorb(await requestRegistered('POST', '/v1/ads/claim', { body: { kind } }));
    if (!r.ok) return r;
    if (r.status !== 202) return { ok: true };
    if (tentativa >= esperas.length) {
      return {
        ok: false,
        pending: true,
        error: testAd ? CLAIM_MESSAGES.testAd : CLAIM_MESSAGES.production,
      };
    }
    await wait(esperas[tentativa]);
  }
}

/** So para os testes: volta ao estado de app recem-aberto. */
export function resetEconomyState() {
  state = { status: 'idle', wallet: null, catalog: null, error: null };
  refreshing = null;
  pendingFinishes.clear();
  listeners.clear();
}

export default {
  economyNow,
  subscribeEconomy,
  refresh,
  birdById,
  priceOf,
  startRun,
  finishRun,
  continueRun,
  useShield,
  buy,
  claimBirdPurchase,
  equip,
  claimAd,
};

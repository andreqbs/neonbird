import { t } from '../i18n';
import economy from './economy';
import { playerNow } from './identity';
import { sha256Hex } from './sha256';

/**
 * A compra com dinheiro dos passaros e das skins (Google Play Billing, pelo
 * expo-iap).
 *
 * QUEM ENTREGA E O SERVIDOR. O app abre o pagamento do Google Play; quando o
 * Google aprova, o app manda o token da compra ao servidor, que confere com o
 * Google e so entao poe o passaro (ou a skin) na conta (server/billing.go). So
 * depois disso o app fecha a compra no aparelho (finishTransaction).
 *
 * Compra que ficou pelo caminho nao se perde — app fechado no meio, sem
 * internet, pagamento pendente que aprovou depois, app reinstalado: a cada
 * abertura o app pede ao Google as compras que ele ainda guarda e manda ao
 * servidor as que a carteira nao tem (syncPurchases).
 *
 * O QUE se compra com dinheiro, e com qual produto, vem do servidor
 * (server/catalog.go, campo ProductID de cada passaro e de cada skin). O VALOR
 * em reais vem do Google Play, que e onde ele e cadastrado.
 *
 * So no Android. No iPhone e na web a loja vende so por moedas.
 */

/** O que o jogador le, no idioma do jogo. Sem bastidor: nem Google nem servidor. */
export const BILLING_MESSAGES = {
  get unavailable() {
    return t('billing.unavailable');
  },
  get pending() {
    return t('billing.pending');
  },
  get later() {
    return t('billing.later');
  },
  get failed() {
    return t('billing.failed');
  },
};

let iap; // o modulo nativo: undefined = ainda nao procurei; null = nao ha
let conexao = null;
const precos = new Map(); // productId -> preco escrito ("R$ 4,99")
const esperando = new Map(); // productId -> quem espera a compra em curso
const ouvintes = new Set();

function nativeIap() {
  if (iap !== undefined) return iap;
  iap = null;
  try {
    const { Platform } = require('react-native');
    if (Platform.OS !== 'android') return iap;
    iap = require('expo-iap');
  } catch (e) {
    // App sem o modulo nativo (build antiga, Expo Go): so moedas.
    iap = null;
  }
  return iap;
}

/** So para os testes: troca o modulo nativo por um dublê. Sem argumento, volta ao normal. */
export function __setIap(fake) {
  iap = fake === undefined ? undefined : fake;
  conexao = null;
  precos.clear();
  esperando.clear();
}

/** Este aparelho compra com dinheiro? */
export function isAvailable() {
  return Boolean(nativeIap());
}

/** Quem precisa redesenhar quando os precos chegam. */
export function subscribeBilling(listener) {
  ouvintes.add(listener);
  return () => ouvintes.delete(listener);
}

function avisaOuvintes() {
  for (const ouvinte of ouvintes) ouvinte();
}

/** Conecta com o Google Play uma vez, e liga quem escuta as compras. */
function conecta() {
  const mod = nativeIap();
  if (!mod) return Promise.resolve(false);
  if (!conexao) {
    conexao = (async () => {
      try {
        await mod.initConnection();
        mod.purchaseUpdatedListener((compra) => {
          tratarCompra(compra).catch(() => {});
        });
        mod.purchaseErrorListener((erro) => tratarErro(erro));
        return true;
      } catch (e) {
        conexao = null;
        return false;
      }
    })();
  }
  return conexao;
}

/** O que se compra com este produto: { kind: 'bird' | 'skin', item }, ou null. */
function itemOfProduct(productId) {
  if (!productId) return null;
  const catalogo = economy.economyNow().catalog || {};
  const bird = (catalogo.birds || []).find((b) => b.productId === productId);
  if (bird) return { kind: 'bird', item: bird };
  const skin = (catalogo.skins || []).find((s) => s.productId === productId);
  return skin ? { kind: 'skin', item: skin } : null;
}

/** Busca no Google Play o preco de cada item (passaro ou skin) que se compra com dinheiro. */
export async function loadPrices(items) {
  const ids = (items || []).map((b) => b.productId).filter(Boolean);
  if (ids.length === 0 || !(await conecta())) return;
  try {
    const produtos = await nativeIap().fetchProducts({ skus: ids, type: 'in-app' });
    for (const p of produtos || []) {
      if (p && p.id && p.displayPrice) precos.set(p.id, p.displayPrice);
    }
    avisaOuvintes();
  } catch (e) {
    // Sem preco, o botao de dinheiro so nao aparece.
  }
}

/** O preco escrito de um produto ("R$ 4,99"), ou null antes de chegar. */
export function priceOf(productId) {
  return (productId && precos.get(productId)) || null;
}

/**
 * Compra com dinheiro um passaro ou uma skin do catalogo (qualquer item com
 * `productId`). Resolve com { ok: true } quando o item ja esta na carteira;
 * { pending } se o pagamento ficou pendente; { cancelled } se o jogador
 * desistiu; ou { ok: false, error }.
 */
export async function buyItem(item) {
  const mod = nativeIap();
  const jogador = playerNow();
  if (!item || !item.productId || !mod || !jogador || !(await conecta())) {
    return { ok: false, error: BILLING_MESSAGES.unavailable };
  }
  const productId = item.productId;
  return new Promise((resolve) => {
    esperando.set(productId, resolve);
    Promise.resolve(
      mod.requestPurchase({
        request: {
          // O resumo do codigo do jogador vai amarrado na compra: ajuda o Google
          // a barrar fraude, sem mandar nada que identifique a pessoa.
          google: { skus: [productId], obfuscatedAccountId: sha256Hex(jogador.id) },
        },
        type: 'in-app',
      })
    ).catch((erro) => {
      esperando.delete(productId);
      resolve(respostaDeErro(erro));
    });
  });
}

/** Os nomes de sempre: o passaro e a skin se compram do mesmo jeito. */
export const buyBird = buyItem;
export const buySkin = buyItem;

function responde(productId, resposta) {
  const fim = esperando.get(productId);
  if (!fim) return;
  esperando.delete(productId);
  fim(resposta);
}

/** A compra voltou do Google Play (aprovada, pendente...). */
async function tratarCompra(compra) {
  if (!compra) return;
  const { productId } = compra;
  if (compra.purchaseState === 'pending') {
    responde(productId, { ok: false, pending: true, error: BILLING_MESSAGES.pending });
    return;
  }
  if (compra.purchaseState !== 'purchased' || !compra.purchaseToken) return;
  responde(productId, await entrega(compra));
}

/** Leva a compra ao servidor e, com o item na conta, fecha a compra no aparelho. */
async function entrega(compra) {
  const alvo = itemOfProduct(compra.productId);
  if (!alvo) return { ok: false, error: BILLING_MESSAGES.unavailable };
  const r =
    alvo.kind === 'skin'
      ? await economy.claimSkinPurchase(alvo.item.id, compra.purchaseToken)
      : await economy.claimBirdPurchase(alvo.item.id, compra.purchaseToken);
  if (r.ok) {
    try {
      await nativeIap().finishTransaction({ purchase: compra, isConsumable: false });
    } catch (e) {
      // O servidor tambem confirma no Google: se aqui falhar, la resolve.
    }
    return { ok: true };
  }
  if (r.pending) return { ok: false, pending: true, error: BILLING_MESSAGES.pending };
  // Sem rede agora: a compra continua guardada no Google e sobe na proxima
  // abertura do app (syncPurchases).
  return { ok: false, error: r.offline ? BILLING_MESSAGES.later : r.error || BILLING_MESSAGES.failed };
}

function respostaDeErro(erro) {
  const mod = nativeIap();
  const desistiu =
    (mod && typeof mod.isUserCancelledError === 'function' && mod.isUserCancelledError(erro)) ||
    (erro && /cancel/i.test(String(erro.code || '')));
  return desistiu ? { ok: false, cancelled: true } : { ok: false, error: BILLING_MESSAGES.failed };
}

/** Erro na tela do Google Play: vale para a compra em curso. */
function tratarErro(erro) {
  const resposta = respostaDeErro(erro);
  for (const productId of [...esperando.keys()]) responde(productId, resposta);
}

/**
 * Manda ao servidor as compras que o Google ainda guarda e a carteira nao tem.
 * Devolve quantos itens (passaros e skins) chegaram.
 */
export async function syncPurchases() {
  const mod = nativeIap();
  if (!mod || !(await conecta())) return 0;
  let compras;
  try {
    compras = await mod.getAvailablePurchases();
  } catch (e) {
    return 0;
  }
  const carteira = economy.economyNow().wallet;
  const donos = new Set([
    ...((carteira && carteira.ownedBirds) || []),
    ...((carteira && carteira.ownedSkins) || []),
  ]);
  let chegaram = 0;
  for (const compra of compras || []) {
    if (compra.purchaseState !== 'purchased' || !compra.purchaseToken) continue;
    const alvo = itemOfProduct(compra.productId);
    if (!alvo) continue;
    // Ja esta na conta e fechada no aparelho: nada a fazer.
    if (donos.has(alvo.item.id) && compra.isAcknowledgedAndroid) continue;
    const r = await entrega(compra);
    if (r.ok) chegaram += 1;
  }
  return chegaram;
}

export default {
  isAvailable,
  subscribeBilling,
  loadPrices,
  priceOf,
  buyItem,
  buyBird,
  buySkin,
  syncPurchases,
};

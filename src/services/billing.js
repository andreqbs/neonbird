import economy from './economy';
import { playerNow } from './identity';
import { sha256Hex } from './sha256';

/**
 * A compra com dinheiro dos passaros (Google Play Billing, pelo expo-iap).
 *
 * QUEM ENTREGA O PASSARO E O SERVIDOR. O app abre o pagamento do Google Play;
 * quando o Google aprova, o app manda o token da compra ao servidor, que confere
 * com o Google e so entao poe o passaro na conta (server/billing.go). So depois
 * disso o app fecha a compra no aparelho (finishTransaction).
 *
 * Compra que ficou pelo caminho nao se perde — app fechado no meio, sem
 * internet, pagamento pendente que aprovou depois, app reinstalado: a cada
 * abertura o app pede ao Google as compras que ele ainda guarda e manda ao
 * servidor as que a carteira nao tem (syncPurchases).
 *
 * QUAIS passaros se compram com dinheiro, e com qual produto, vem do servidor
 * (server/catalog.go, campo ProductID). O VALOR em reais vem do Google Play,
 * que e onde ele e cadastrado.
 *
 * So no Android. No iPhone e na web a loja vende so por moedas.
 */

/** O que o jogador le. Sem bastidor: nem Google nem servidor. */
export const BILLING_MESSAGES = {
  unavailable: 'Compra indisponível neste aparelho.',
  pending: 'Pagamento pendente. O pássaro chega assim que o pagamento for aprovado.',
  later: 'Pagamento feito! O pássaro aparece na sua conta assim que a internet voltar.',
  failed: 'Não deu para concluir a compra. Tente de novo.',
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

/** O passaro do catalogo que se compra com este produto. */
function birdOfProduct(productId) {
  const birds = (economy.economyNow().catalog || {}).birds || [];
  return birds.find((b) => b.productId && b.productId === productId) || null;
}

/** Busca no Google Play o preco de cada passaro que se compra com dinheiro. */
export async function loadPrices(birds) {
  const ids = (birds || []).map((b) => b.productId).filter(Boolean);
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
 * Compra um passaro com dinheiro. Resolve com { ok: true } quando o passaro ja
 * esta na carteira; { pending } se o pagamento ficou pendente; { cancelled } se
 * o jogador desistiu; ou { ok: false, error }.
 */
export async function buyBird(bird) {
  const mod = nativeIap();
  const jogador = playerNow();
  if (!bird || !bird.productId || !mod || !jogador || !(await conecta())) {
    return { ok: false, error: BILLING_MESSAGES.unavailable };
  }
  return new Promise((resolve) => {
    esperando.set(bird.productId, resolve);
    Promise.resolve(
      mod.requestPurchase({
        request: {
          // O resumo do codigo do jogador vai amarrado na compra: ajuda o Google
          // a barrar fraude, sem mandar nada que identifique a pessoa.
          google: { skus: [bird.productId], obfuscatedAccountId: sha256Hex(jogador.id) },
        },
        type: 'in-app',
      })
    ).catch((erro) => {
      esperando.delete(bird.productId);
      resolve(respostaDeErro(erro));
    });
  });
}

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

/** Leva a compra ao servidor e, com o passaro na conta, fecha a compra no aparelho. */
async function entrega(compra) {
  const bird = birdOfProduct(compra.productId);
  if (!bird) return { ok: false, error: BILLING_MESSAGES.unavailable };
  const r = await economy.claimBirdPurchase(bird.id, compra.purchaseToken);
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
 * Devolve quantos passaros chegaram.
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
  const donos = new Set((carteira && carteira.ownedBirds) || []);
  let chegaram = 0;
  for (const compra of compras || []) {
    if (compra.purchaseState !== 'purchased' || !compra.purchaseToken) continue;
    const bird = birdOfProduct(compra.productId);
    if (!bird) continue;
    // Ja esta na conta e fechada no aparelho: nada a fazer.
    if (donos.has(bird.id) && compra.isAcknowledgedAndroid) continue;
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
  buyBird,
  syncPurchases,
};

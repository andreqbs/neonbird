import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@major-flyer/player';

/** Limites do nome que o jogador escolhe. */
export const NAME_MIN = 2;
export const NAME_MAX = 18;

/**
 * Quem e o jogador neste aparelho.
 *
 * Sao dois identificadores, e a diferenca entre eles e o que segura a
 * brincadeira de pe:
 *
 *   `id`     — o codigo PUBLICO. E o que o jogador copia e manda para o amigo
 *              que vai chama-lo para o grupo.
 *   `secret` — a senha. Nunca aparece na tela e so viaja nas chamadas ao
 *              servidor. Sem ele, saber o codigo de alguem daria para entrar no
 *              lugar da pessoa e mandar pontos no nome dela.
 *
 * Nao ha login, e-mail nem senha para o jogador decorar: o aparelho e a conta.
 * Trocar de aparelho hoje significa comecar outro codigo — o preco de nao pedir
 * cadastro para jogar.
 *
 * Mesmo desenho de `lives.js`: o valor vive na memoria (leitura sincrona, sem
 * esperar disco) e a gravacao vai atras.
 */

const HEX = '0123456789abcdef';

/**
 * UUID v4. Usa o gerador do sistema quando existe (web e RN recentes) e cai
 * para `Math.random` quando nao — o suficiente para identificar um jogador
 * casual, e o comentario fica aqui para ninguem confundir isso com chave.
 */
export function newUuid() {
  const rnd = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  const bytes = new Uint8Array(16);
  if (rnd) rnd(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versao 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante

  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  }
  return out;
}

/** Nome de estreia: melhor um apelido pronto do que um campo vazio. */
export function suggestName() {
  return `Piloto ${1000 + Math.floor(Math.random() * 9000)}`;
}

/** Corta espacos, limita o tamanho e recusa o que sobrar vazio demais. */
export function sanitizeName(name) {
  const limpo = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return limpo.length >= NAME_MIN ? limpo : null;
}

// -------------------------------------------------------------------- memoria

let player = null; // { id, secret, name }
let loaded = false;
let writing = Promise.resolve();
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener(player, loaded);
}

function persist() {
  const snapshot = player;
  writing = writing
    .then(() => AsyncStorage.setItem(KEY, JSON.stringify(snapshot)))
    .catch(() => {});
  return writing;
}

/** O jogador AGORA, sem esperar disco. Null antes da primeira leitura. */
export function playerNow() {
  return player;
}

export function playerLoaded() {
  return loaded;
}

export function subscribePlayer(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Leitura inicial, uma vez por sessao. Na primeira vez de todas, inventa o
 * jogador: dois UUIDs e um apelido.
 */
export async function initPlayer() {
  if (loaded) return player;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const salvo = raw ? JSON.parse(raw) : null;
    if (salvo && salvo.id && salvo.secret) {
      player = { id: salvo.id, secret: salvo.secret, name: salvo.name || suggestName() };
    }
  } catch (e) {
    // disco ilegivel: melhor um jogador novo do que nenhum
  }

  if (!player) {
    player = { id: newUuid(), secret: newUuid(), name: suggestName() };
    persist();
  }
  loaded = true;
  emit();
  return player;
}

/** Troca o apelido. Devolve o nome aceito, ou null se o texto nao servia. */
export function renamePlayer(name) {
  const limpo = sanitizeName(name);
  if (!limpo || !player) return null;
  player = { ...player, name: limpo };
  emit();
  persist();
  return limpo;
}

/** So para os testes: devolve o modulo ao estado de app recem-instalado. */
export function resetPlayerState() {
  player = null;
  loaded = false;
  writing = Promise.resolve();
  listeners.clear();
}

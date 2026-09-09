import AsyncStorage from '@react-native-async-storage/async-storage';

import { playerNow } from './identity';

/**
 * A parte online do jogo: grupos, rodadas e ranking.
 *
 * Do outro lado esta o servidor deste repositorio, em `server/` — Go + Postgres,
 * feito para rodar na VPS com `docker compose up -d`. As instrucoes de subir
 * estao em `server/README.md`.
 *
 * ----------------------------------------------------------------------------
 * PARA LIGAR: escreva o endereco do seu servidor em `DEFAULT_API_URL`, logo
 * aqui embaixo. So isso.
 *
 * Quem preferir nao mexer no codigo pode deixar `EXPO_PUBLIC_API_URL` no `.env`
 * da raiz: o Expo troca isso na hora do build, e ai da para ter um endereco no
 * seu computador e outro na loja sem trocar de arquivo. O `.env` ganha.
 * ----------------------------------------------------------------------------
 *
 * COMO ISSO SE COMPORTA SEM CONFIGURACAO: exatamente como os anuncios sem
 * AdMob — responde "nao da" na hora, e o jogo segue inteiro no aparelho, com
 * recorde e historico locais. Nenhuma tela fica pendurada esperando rede.
 *
 * IDENTIFICACAO: nao ha login nem token. Cada chamada que escreve leva o par
 * (codigo, segredo) do aparelho em dois cabecalhos. O codigo e publico — e o
 * que o jogador manda para o amigo que vai chama-lo para o grupo; o segredo
 * nunca aparece na tela. Ver `identity.js` e `server/README.md`.
 */

/** O endereco do servidor. Vazio = ranking online desligado. */
export const DEFAULT_API_URL = '';

const API_URL = String(process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

/** Quanto esperamos por uma resposta antes de desistir e seguir o jogo. */
const TIMEOUT_MS = 8000;

/** Partidas jogadas sem rede esperam aqui ate dar para mandar. */
const PENDING_KEY = '@major-flyer/pending-runs';

/** Pendencia velha nao sobe: ela cairia numa rodada que nao e mais a dela. */
const PENDING_MAX_AGE_MS = 12 * 3600 * 1000;

export function isConfigured() {
  return Boolean(API_URL);
}

export function apiUrl() {
  return API_URL;
}

// ------------------------------------------------------------------ transporte

/** Cabecalhos de identificacao, quando ja existe jogador neste aparelho. */
function authHeaders() {
  const p = playerNow();
  if (!p) return null;
  return { 'X-Player-Id': p.id, 'X-Player-Secret': p.secret };
}

/**
 * Uma chamada ao servidor. Nunca levanta excecao: devolve sempre
 * `{ ok, data, error, status }`, porque quem chama e tela de jogo, nao servidor.
 */
async function request(method, path, { body, auth = true } = {}) {
  if (!isConfigured()) return { ok: false, error: 'offline' };

  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const id = authHeaders();
    if (!id) return { ok: false, error: 'sem jogador' };
    Object.assign(headers, id);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const texto = await res.text();
    const corpo = texto ? JSON.parse(texto) : null;

    if (!res.ok) {
      // O servidor manda a regra ja escrita para o jogador ler ("o grupo já
      // tem 8 jogadores"). Traduzir de novo aqui so faria as duas pontas
      // discordarem.
      return { ok: false, error: corpo?.error || `erro ${res.status}`, status: res.status };
    }
    return { ok: true, data: corpo, status: res.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'demorou demais' : 'sem conexão' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------- conta

/** Apresenta o jogador ao servidor (ou atualiza o apelido dele). */
export async function syncPlayer() {
  const p = playerNow();
  if (!p) return { ok: false, error: 'sem jogador' };
  return request('POST', '/v1/players', {
    auth: false,
    body: { id: p.id, secret: p.secret, name: p.name },
  });
}

/**
 * Faz a chamada e, se o servidor nao conhecer este aparelho, apresenta o
 * jogador e tenta de novo — uma vez.
 *
 * Isso acontece de verdade: servidor novo, banco restaurado de um backup mais
 * antigo, ou uma partida terminando antes de o registro da abertura chegar.
 * Sem isso, o placar iria para a fila de pendentes e falharia para sempre.
 */
async function requestRegistered(method, path, options) {
  const r = await request(method, path, options);
  if (r.status !== 401) return r;

  const registro = await syncPlayer();
  if (!registro.ok) return r;
  return request(method, path, options);
}

// ------------------------------------------------------------------- partidas

async function readPending() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}

async function writePending(lista) {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(lista.slice(-50)));
  } catch (e) {
    // sem disco: perde a pendencia, e paciencia — o placar local nao depende disso
  }
}

/**
 * Manda um placar para a rodada.
 *
 * Sem rede (ou sem configuracao), a partida fica guardada e sobe na proxima que
 * der certo. Pontos feitos no metro nao deveriam sumir por causa do metro.
 */
export async function submitRun(points) {
  if (!isConfigured() || !playerNow()) return { ok: false, error: 'offline' };
  if (!(points > 0)) return { ok: false, error: 'placar zero' };

  const pontos = Math.floor(points);
  const resultado = await requestRegistered('POST', '/v1/runs', { body: { points: pontos } });
  if (resultado.ok) {
    flushPending(); // aproveita que a rede esta boa
    return resultado;
  }

  // Placar recusado pela regra (rodada em apuracao, numero absurdo) nao volta
  // para a fila: tentar de novo daria o mesmo "nao".
  if (resultado.status >= 400 && resultado.status < 500 && resultado.status !== 401) {
    return resultado;
  }

  const lista = await readPending();
  lista.push({ points: pontos, at: Date.now() });
  await writePending(lista);
  return resultado;
}

/** Tenta subir o que ficou para tras. Silencioso: e trabalho de fundo. */
export async function flushPending() {
  if (!isConfigured() || !playerNow()) return 0;
  const lista = await readPending();
  if (!lista.length) return 0;

  const agora = Date.now();
  const restantes = [];
  let enviadas = 0;

  for (const item of lista) {
    if (agora - item.at > PENDING_MAX_AGE_MS) continue; // velha demais: descarta
    const r = await requestRegistered('POST', '/v1/runs', { body: { points: item.points } });
    if (r.ok) enviadas++;
    else if (!(r.status >= 400 && r.status < 500)) restantes.push(item);
  }

  await writePending(restantes);
  return enviadas;
}

// --------------------------------------------------------------------- grupos

export async function createGroup(name) {
  return requestRegistered('POST', '/v1/groups', { body: { name } });
}

/** So o lider chama alguem, e chama pelo codigo publico do outro. */
export async function addMember(playerId) {
  return requestRegistered('POST', '/v1/groups/members', { body: { playerId } });
}

export async function leaveGroup() {
  return requestRegistered('DELETE', '/v1/groups/me');
}

export async function myGroup() {
  return requestRegistered('GET', '/v1/groups/me');
}

// -------------------------------------------------------------------- ranking

export async function topPlayers(limit = 50) {
  return request('GET', `/v1/rankings/players?limit=${limit}`, { auth: false });
}

export async function topGroups(limit = 50) {
  return request('GET', `/v1/rankings/groups?limit=${limit}`, { auth: false });
}

export async function myStanding() {
  return requestRegistered('GET', '/v1/me/standing');
}

export default {
  isConfigured,
  apiUrl,
  syncPlayer,
  submitRun,
  flushPending,
  createGroup,
  addMember,
  leaveGroup,
  myGroup,
  topPlayers,
  topGroups,
  myStanding,
};

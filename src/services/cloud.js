import { playerNow } from './identity';

/**
 * A conversa com o servidor do jogo (pasta `server/`, Go + Postgres).
 *
 * Este arquivo e o transporte e as rotas de grupo e ranking. A economia —
 * moedas, vidas, loja, partidas — fica em `economy.js`, que usa o `request`
 * daqui.
 *
 * ----------------------------------------------------------------------------
 * PARA LIGAR: escreva o endereco do seu servidor em `DEFAULT_API_URL`, logo
 * aqui embaixo. So isso.
 *
 * Quem preferir nao mexer no codigo pode deixar `EXPO_PUBLIC_API_URL` no `.env`
 * da raiz: o Expo troca isso na hora do build, e ai da para ter um endereco no
 * seu computador e outro na loja sem trocar de arquivo. O `.env` ganha. (Para o
 * build da loja via EAS, prefira a constante — ver server/README.md.)
 * ----------------------------------------------------------------------------
 *
 * SEM ENDERECO, OU SEM INTERNET: toda chamada responde `offline` na hora, e o
 * jogo abre no modo treino. Nenhuma tela fica pendurada esperando rede.
 *
 * IDENTIFICACAO: nao ha login nem token. Cada chamada que escreve leva o par
 * (codigo, segredo) do aparelho em dois cabecalhos. O codigo e publico — e o
 * que o jogador manda para o amigo que vai chama-lo para o grupo; o segredo
 * nunca aparece na tela. Ver `identity.js` e `server/README.md`.
 */

/** O endereco do servidor. Vazio = so o modo treino. */
export const DEFAULT_API_URL = '';

const API_URL = String(process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');

/** Quanto cada tentativa espera por uma resposta antes de desistir. */
const TIMEOUT_MS = 8000;

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
 * `{ ok, data, error, code, status, offline }`.
 *
 * `offline: true` quer dizer que a conversa nem aconteceu (sem endereco, sem
 * rede, demorou demais). E a diferenca que o jogo usa para escolher entre "o
 * servidor disse nao" — mostra o motivo — e "estamos sem internet" — oferece o
 * treino.
 *
 * `retry`: o pedido pode ser repetido sem efeito em dobro — consulta, fechar
 * partida (o servidor devolve o mesmo resultado), apresentar o jogador. Quando
 * nenhuma resposta volta, ele tenta mais uma vez. Abrir partida, comprar e
 * trocar video por premio NUNCA repetem sozinhos: a primeira tentativa pode ter
 * chegado e so a resposta ter se perdido.
 *
 * `headers`: cabecalhos extras so deste pedido — hoje, a prova de integridade da
 * partida (integrity.js).
 */
export async function request(
  method,
  path,
  { body, auth = true, headers: extras, retry = method === 'GET' } = {}
) {
  if (!isConfigured()) return { ok: false, error: 'offline', offline: true };

  const headers = {
    'Content-Type': 'application/json',
    // Conexao nova a cada pedido. Entre um pedido e outro o jogo passa muito
    // tempo calado — a partida inteira, um video de 30 s —, e conexao parada
    // pode morrer EM SILENCIO no caminho ate a VPS: alguem no meio (operadora,
    // roteador, firewall) esquece dela sem avisar as pontas. O Android
    // reaproveitaria a conexao morta, o pedido sumiria, e o jogador leria "sem
    // conexao" com a internet funcionando. Custa um aperto de mao por pedido, e
    // o jogo faz poucos.
    Connection: 'close',
  };
  if (auth) {
    const id = authHeaders();
    if (!id) return { ok: false, error: 'sem jogador' };
    Object.assign(headers, id);
  }
  if (extras) Object.assign(headers, extras);

  const payload = body === undefined ? undefined : JSON.stringify(body);
  const r = await attempt(method, path, headers, payload);
  // Sem status e porque nenhuma resposta voltou. Quem pode repetir, repete — ja
  // numa conexao nova.
  if (retry && r.offline && r.status === undefined) {
    return attempt(method, path, headers, payload);
  }
  return r;
}

/** Uma tentativa: o fetch com prazo e a resposta traduzida. */
async function attempt(method, path, headers, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      offline: true,
      error: e.name === 'AbortError' ? 'o servidor demorou demais' : 'sem conexão',
    };
  }

  let corpo = null;
  try {
    const texto = await res.text();
    corpo = texto ? JSON.parse(texto) : null;
  } catch (e) {
    // Resposta que nao e JSON (pagina de erro de um proxy, por exemplo): o
    // status ainda diz o que aconteceu.
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // O servidor manda a regra ja escrita para o jogador ler ("moedas
    // insuficientes") e um codigo para o app decidir o que fazer.
    return {
      ok: false,
      status: res.status,
      code: corpo?.code,
      error: corpo?.error || `erro ${res.status}`,
      // Servidor fora do ar atras do proxy conta como sem conexao.
      offline: res.status === 502 || res.status === 503 || res.status === 504,
    };
  }
  return { ok: true, status: res.status, data: corpo };
}

// ---------------------------------------------------------------------- conta

/** Apresenta o jogador ao servidor (ou atualiza o apelido dele). */
export async function syncPlayer() {
  const p = playerNow();
  if (!p) return { ok: false, error: 'sem jogador' };
  // Repetir e seguro: na segunda vez o servidor so grava o apelido de novo.
  return request('POST', '/v1/players', {
    auth: false,
    retry: true,
    body: { id: p.id, secret: p.secret, name: p.name },
  });
}

/**
 * Faz a chamada e, se o servidor nao conhecer este aparelho, apresenta o
 * jogador e tenta de novo — uma vez.
 *
 * Isso acontece de verdade: servidor novo, banco restaurado de um backup mais
 * antigo, ou a primeira chamada da instalacao saindo antes do registro.
 */
export async function requestRegistered(method, path, options) {
  const r = await request(method, path, options);
  if (r.status !== 401) return r;

  const registro = await syncPlayer();
  if (!registro.ok) return r;
  return request(method, path, options);
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
  request,
  requestRegistered,
  syncPlayer,
  createGroup,
  addMember,
  leaveGroup,
  myGroup,
  topPlayers,
  topGroups,
  myStanding,
};

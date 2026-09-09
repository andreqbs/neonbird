/**
 * Rodadas semanais.
 *
 * Uma rodada abre **domingo as 20h** e fecha **domingo seguinte as 18h**. As
 * duas horas que sobram (18h -> 20h) sao de proposito: e a janela de apuracao,
 * em que ninguem mais pontua e os totais podem ser conferidos antes da rodada
 * nova comecar.
 *
 * Tudo aqui e conta pura, sem rede e sem disco, e por isso da para testar no
 * `npm test`. O servidor refaz a mesma conta (ver `server/season.go`): o id da
 * rodada e a DATA do domingo em que ela abriu, entao os dois lados chegam ao
 * mesmo texto sem precisar combinar nada.
 */

/** Fuso das rodadas. -3 = horario de Brasilia, sem horario de verao. */
export const SEASON_TZ_OFFSET = -3;

export const SEASON_OPEN_HOUR = 20; // domingo, abre
export const SEASON_CLOSE_HOUR = 18; // domingo seguinte, fecha para apuracao

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Estados possiveis de uma rodada. */
export const SEASON_STATE = {
  RUNNING: 'running', // valendo: pontos contam
  COUNTING: 'counting', // fechada, em apuracao: ninguem mais pontua
};

const pad = (n) => String(n).padStart(2, '0');

/** Data (UTC) deslocada para a hora local das rodadas. */
function toLocal(date) {
  return new Date(date.getTime() + SEASON_TZ_OFFSET * HOUR);
}

/** O texto `YYYY-MM-DD` de um instante ja em hora local. */
function localDateId(local) {
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/**
 * A rodada que contem (ou acabou de conter) este instante.
 *
 * Devolve o id, os tres marcos e o estado. Na janela de apuracao a rodada
 * devolvida ainda e a que fechou — e o que a tela precisa mostrar, com os
 * numeros dela, ate a proxima abrir.
 */
export function seasonAt(when = new Date()) {
  const local = toLocal(when instanceof Date ? when : new Date(when));

  // Domingo 20h mais recente, em hora local.
  const abertura = new Date(local.getTime());
  abertura.setUTCHours(SEASON_OPEN_HOUR, 0, 0, 0);
  // Volta ao domingo (0 = domingo) e, se ainda nao deu 20h de domingo, uma
  // semana para tras.
  abertura.setUTCDate(abertura.getUTCDate() - abertura.getUTCDay());
  if (abertura.getTime() > local.getTime()) abertura.setUTCDate(abertura.getUTCDate() - 7);

  const startLocal = abertura.getTime();
  const endLocal = startLocal + WEEK - (SEASON_OPEN_HOUR - SEASON_CLOSE_HOUR) * HOUR;
  const closeLocal = startLocal + WEEK;

  const paraUtc = (t) => new Date(t - SEASON_TZ_OFFSET * HOUR);

  return {
    id: localDateId(new Date(startLocal)),
    startsAt: paraUtc(startLocal),
    endsAt: paraUtc(endLocal), // fim da pontuacao
    nextOpensAt: paraUtc(closeLocal),
    state: local.getTime() < endLocal ? SEASON_STATE.RUNNING : SEASON_STATE.COUNTING,
  };
}

/** Atalho: a rodada de agora. */
export function currentSeason() {
  return seasonAt(new Date());
}

/** Quanto falta, em ms, para o proximo marco (fim da pontuacao ou abertura). */
export function msUntilNext(season, when = new Date()) {
  const alvo = season.state === SEASON_STATE.RUNNING ? season.endsAt : season.nextOpensAt;
  return Math.max(0, alvo.getTime() - when.getTime());
}

/**
 * "3d 4h" / "12h 30min" / "8min" — o tanto que falta, em texto curto.
 *
 * Sem segundos de proposito: um contador de segundos numa tela que ninguem
 * fica olhando so custa render.
 */
export function formatRemaining(ms) {
  if (ms <= 0) return 'agora';
  const min = Math.floor(ms / 60000);
  const dias = Math.floor(min / (60 * 24));
  const horas = Math.floor((min % (60 * 24)) / 60);
  const minutos = min % 60;
  if (dias > 0) return horas > 0 ? `${dias}d ${horas}h` : `${dias}d`;
  if (horas > 0) return minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`;
  return `${minutos}min`;
}

/** Rotulo curto da rodada, do tipo "6 a 13 de setembro". */
export function seasonLabel(season) {
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const inicio = toLocal(season.startsAt);
  const fim = toLocal(season.endsAt);
  const mesInicio = meses[inicio.getUTCMonth()];
  const mesFim = meses[fim.getUTCMonth()];
  if (mesInicio === mesFim) {
    return `${inicio.getUTCDate()} a ${fim.getUTCDate()} de ${mesFim}`;
  }
  return `${inicio.getUTCDate()} de ${mesInicio} a ${fim.getUTCDate()} de ${mesFim}`;
}

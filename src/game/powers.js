import { FIXED_DT } from './constants';

/**
 * Os poderes dos passaros.
 *
 * ----------------------------------------------------------------------------
 * QUEM TEM QUAL PODER, e com que numeros (tempo ligado, recarga, raio, quanto
 * mais lento), NAO e decidido aqui: e no servidor, em `server/catalog.go`. O app
 * recebe a lista de poderes junto com a partida e so executa. Trocar o poder de
 * um passaro, ou dar dois a ele, e mexer la — sem build nova do app.
 *
 * Aqui mora o COMPORTAMENTO de cada poder no voo. Poder novo = uma entrada nova
 * em `BEHAVIORS` (com o mesmo `id` que o catalogo do servidor usar).
 * ----------------------------------------------------------------------------
 *
 * Cada comportamento e um objeto com ganchos opcionais, chamados pelo mundo
 * (World.js) nos momentos certos. Todos recebem `(state, world, params)`:
 *
 *   start          partida nova
 *   stage          fase nova
 *   frame          cada passo com o voo rolando (so em PLAYING: pausa, painel e
 *                  anuncio nao gastam o relogio)
 *   coin           pegou uma moeda (o obstaculo dela vem como 4o argumento)
 *   hit            bateu num obstaculo sem escudo. Devolver true perdoa a
 *                  batida — e ai e o poder quem tira o passaro do perigo
 *   revive         voltou com a nova chance
 *   status(state)  o que o HUD mostra: { active, level } (so poder com relogio,
 *                  marcado com `timed: true`)
 *
 * `state` e o estado daquele poder naquela partida; `params` sao os numeros que
 * vieram do servidor. Varios poderes no mesmo passaro funcionam juntos: o mundo
 * chama os ganchos de todos.
 *
 * Poderes que mexem em MOEDA ou em NOVA CHANCE (moedas multiplicadas, chance
 * extra) valem pelo servidor, que confere cada partida pela regra dele. Aqui
 * eles so aparecem no HUD — e mesmo um app adulterado nao consegue inventa-los.
 */

const FRAMES_PER_SECOND = 1000 / FIXED_DT;
const frames = (seconds) => Math.max(1, Math.round((seconds || 0) * FRAMES_PER_SECOND));

// ------------------------------------------------------------ ciclo automatico

/**
 * O relogio dos poderes que ligam sozinhos: recarrega por `cooldownSeconds`,
 * fica ligado por `activeSeconds`, recarrega de novo — para sempre.
 *
 * A partida comeca RECARREGANDO: ligar no primeiro segundo, antes de o primeiro
 * obstaculo chegar, seria desperdicar o poder.
 *
 * `holdWhile(world)`: enquanto for verdade, o poder nao desliga mesmo com o
 * tempo esgotado (o invisivel nao some com o passaro dentro do cano).
 */
function cycle({ activeKey = 'activeSeconds', cooldownKey = 'cooldownSeconds' } = {}) {
  return {
    start(state, params) {
      state.active = false;
      state.left = frames(params[cooldownKey]);
      state.total = state.left;
    },
    /** Um passo. Devolve se o poder esta ligado neste passo. */
    tick(state, params, world, holdWhile) {
      if (state.left > 0) state.left -= 1;
      if (state.left > 0) return state.active;
      if (state.active && holdWhile && holdWhile(world)) return true;

      state.active = !state.active;
      state.left = frames(params[state.active ? activeKey : cooldownKey]);
      state.total = state.left;
      return state.active;
    },
    /** Ligado: quanto ainda resta (1 -> 0). Recarregando: quanto ja carregou (0 -> 1). */
    status(state) {
      const fracao = state.total > 0 ? state.left / state.total : 0;
      return { active: state.active, level: state.active ? fracao : 1 - fracao };
    },
  };
}

const relogio = cycle();

// ------------------------------------------------------------------ os poderes

export const BEHAVIORS = {
  /**
   * Ima: enquanto ligado, a moeda que chegar a `reach` raios do passaro voa
   * ate ele — mesmo a que ficaria fora do caminho. Quem puxa a moeda e o mundo
   * (World._pullCoins); o poder so diz o alcance.
   */
  magnet: {
    timed: true,
    start(state, world, params) {
      relogio.start(state, params);
      world.magnetReach = 0;
    },
    frame(state, world, params) {
      const ligado = relogio.tick(state, params, world);
      world.magnetReach = ligado ? world.layout.birdRadius * (params.reach || 5) : 0;
    },
    status: (state) => relogio.status(state),
  },

  /**
   * Invisivel: enquanto ligado, o passaro atravessa os obstaculos. Se o tempo
   * acabar com ele dentro de um cano, espera sair — desligar ali seria bater no
   * cano do qual ele so estava saindo.
   */
  ghost: {
    timed: true,
    start(state, world, params) {
      relogio.start(state, params);
      world.ghost = false;
    },
    frame(state, world, params) {
      world.ghost = relogio.tick(state, params, world, (w) => w.overlapsObstacle());
    },
    status: (state) => relogio.status(state),
  },

  /**
   * Mais lento: enquanto ligado, a fase anda `percent`% mais devagar. A conta e
   * sobre a velocidade da fase ATUAL, que ja tem o aumento dela (World.applyStage).
   */
  slow: {
    timed: true,
    start(state, world, params) {
      relogio.start(state, params);
      world.speedFactor = 1;
    },
    frame(state, world, params) {
      const ligado = relogio.tick(state, params, world);
      world.speedFactor = ligado ? 1 - Math.min(90, Math.max(0, params.percent || 0)) / 100 : 1;
    },
    status: (state) => relogio.status(state),
  },

  /**
   * Nova chance a mais por partida. Quem conta e o servidor (ele devolve
   * `maxContinues` ao abrir a partida); a tela usa `videoOnly` para oferecer a
   * chance extra so em troca de video.
   */
  extraChance: {},

  /** Moedas do voo multiplicadas no fim da partida — conta do servidor. */
  coinMultiplier: {},
};

/** Um icone para cada poder, para a loja e o HUD. */
export const POWER_ICONS = {
  magnet: '🧲',
  ghost: '👻',
  slow: '❄️',
  extraChance: '🔥',
  coinMultiplier: '☄️',
};

// ----------------------------------------------------------------- composicao

/**
 * Junta os poderes de um passaro num objeto so, que o mundo chama sem saber
 * quantos sao nem quais. Poder que este app nao conhece (o servidor e mais
 * novo) e ignorado: o passaro voa com os outros.
 */
export function combinePowers(list) {
  const itens = (Array.isArray(list) ? list : [])
    .filter((p) => p && BEHAVIORS[p.id])
    .map((p) => ({
      id: p.id,
      name: p.name || p.id,
      params: p.params || {},
      behavior: BEHAVIORS[p.id],
      state: {},
    }));

  const chama = (gancho, world, extra) => {
    for (const it of itens) it.behavior[gancho]?.(it.state, world, it.params, extra);
  };

  return {
    list: itens.map(({ id, name, params }) => ({ id, name, params })),
    has: (id) => itens.some((it) => it.id === id),
    param: (id, key) => itens.find((it) => it.id === id)?.params[key],

    onRunStart(world) {
      for (const it of itens) it.state = {};
      chama('start', world);
    },
    onStageStart(world) {
      chama('stage', world);
    },
    onFrame(world) {
      chama('frame', world);
    },
    onCoin(world, pillar) {
      chama('coin', world, pillar);
    },
    onRevive(world) {
      chama('revive', world);
    },
    /** Algum poder perdoa esta batida? */
    onHit(world) {
      let perdoou = false;
      for (const it of itens) {
        if (it.behavior.hit?.(it.state, world, it.params)) perdoou = true;
      }
      return perdoou;
    },
    /** Os poderes com relogio, para o HUD: [{ id, name, active, level }]. */
    status() {
      const out = [];
      for (const it of itens) {
        if (!it.behavior.timed) continue;
        out.push({ id: it.id, name: it.name, ...it.behavior.status(it.state) });
      }
      return out;
    },
  };
}

/** Passaro sem poder nenhum (o de sempre, e o treino). */
export const NO_POWERS = combinePowers([]);

/**
 * Os poderes da partida: os que o servidor mandou junto com ela — sao eles que
 * o servidor vai honrar no fechamento. Sem partida (treino), nenhum.
 */
export function powersOfRun(run) {
  return run && Array.isArray(run.powers) ? run.powers : [];
}

/** Texto curto de um poder para a loja: "🧲 Ímã — puxa as moedas..." */
export function describePower(power) {
  const icone = POWER_ICONS[power.id] || '✨';
  return `${icone} ${power.name}${power.description ? ` — ${power.description}` : ''}`;
}

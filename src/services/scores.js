import AsyncStorage from '@react-native-async-storage/async-storage';

const RUNS_KEY = '@major-flyer/runs';

// Chaves de quando o app se chamava Neon Flyer. Sao lidas uma vez e migradas:
// trocar o nome do jogo nao pode custar o recorde de ninguem.
const LEGACY_RUNS_KEY = '@neon-flyer/runs';
const LEGACY_BEST_KEY = '@neon-flyer/best';

/** Quantas partidas guardamos no historico local. */
const MAX_RUNS = 25;

/**
 * Historico local de partidas. E a fonte da verdade do recorde do aparelho e
 * alimenta a aba "Seus voos" do ranking — funciona offline e sem conta nenhuma.
 *
 * Cada entrada: { score, at (epoch ms), landscape (bool) }
 */

function sortRuns(runs) {
  // Maior placar primeiro; empate desempata pela partida mais recente.
  return runs.slice().sort((a, b) => b.score - a.score || b.at - a.at);
}

async function readRuns(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return sortRuns(parsed.filter((r) => r && Number.isFinite(r.score)));
      }
    }
  } catch (e) {
    // historico corrompido: trata como vazio
  }
  return null;
}

export async function loadRuns() {
  const runs = await readRuns(RUNS_KEY);
  if (runs) return runs;

  // Migra o historico gravado sob o nome antigo do app.
  const legacyRuns = await readRuns(LEGACY_RUNS_KEY);
  if (legacyRuns && legacyRuns.length) {
    try {
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(legacyRuns));
      await AsyncStorage.removeItem(LEGACY_RUNS_KEY);
    } catch (e) {
      // sem disco: a lista da sessao ainda vale
    }
    return legacyRuns;
  }

  // Migra o recorde solto gravado pelas primeiras versoes do app.
  try {
    const legacy = parseInt(await AsyncStorage.getItem(LEGACY_BEST_KEY), 10);
    if (Number.isFinite(legacy) && legacy > 0) {
      const runs = [{ score: legacy, at: Date.now(), landscape: false }];
      await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(runs));
      await AsyncStorage.removeItem(LEGACY_BEST_KEY);
      return runs;
    }
  } catch (e) {
    // sem historico antigo
  }

  return [];
}

export function bestOf(runs) {
  return runs.length ? runs[0].score : 0;
}

/**
 * Registra uma partida. Devolve a lista atualizada e se foi recorde.
 * Placar zero nao entra no historico — so poluiria a lista.
 */
export async function addRun(score, { landscape = false } = {}) {
  const runs = await loadRuns();
  const previousBest = bestOf(runs);

  if (score <= 0) {
    return { runs, best: previousBest, isNewBest: false };
  }

  const next = sortRuns([...runs, { score, at: Date.now(), landscape }]).slice(0, MAX_RUNS);
  try {
    await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(next));
  } catch (e) {
    // sem espaco em disco: o placar da sessao ainda vale
  }

  return { runs: next, best: bestOf(next), isNewBest: score > previousBest };
}

export async function clearRuns() {
  try {
    await AsyncStorage.multiRemove([RUNS_KEY, LEGACY_RUNS_KEY, LEGACY_BEST_KEY]);
  } catch (e) {
    // nada a fazer
  }
  return [];
}

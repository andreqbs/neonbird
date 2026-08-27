import { useCallback, useEffect, useState } from 'react';

import { addRun, bestOf, loadRuns } from '../services/scores';
import { submitScore as submitToPlayGames } from '../services/playGames';

/**
 * Historico de partidas + recorde. Grava local sempre, e empurra o placar para
 * o Google Play Jogos quando ele estiver disponivel (falha em silencio se nao).
 */
export default function useScores() {
  const [runs, setRuns] = useState([]);
  const [best, setBest] = useState(0);

  const refresh = useCallback(async () => {
    const list = await loadRuns();
    setRuns(list);
    setBest(bestOf(list));
    return list;
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  /** Registra a partida. Devolve `true` se bateu o recorde do aparelho. */
  const submit = useCallback(async (score, meta) => {
    const result = await addRun(score, meta);
    setRuns(result.runs);
    setBest(result.best);
    submitToPlayGames(score);
    return result.isNewBest;
  }, []);

  return { runs, best, refresh, submit };
}

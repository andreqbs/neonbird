import { useCallback, useEffect, useRef, useState } from 'react';

import audio from '../audio/AudioManager';
import ads from '../services/ads';

/**
 * Os anuncios vistos pela tela: em que pe esta o video e o que fazer quando ele
 * acaba.
 *
 * Tres telas precisam disso — o escudo e a troca de fase no fim de fase, as
 * vidas no fim da partida, a recarga na Home — e todas precisam do MESMO
 * cuidado: enquanto nao houver SDK e IDs do AdMob, roda a propaganda simulada;
 * o audio do jogo cala enquanto o anuncio esta na frente; e nenhum caminho fica
 * pendurado esperando um video que nunca vem.
 *
 * `adState`: 'idle' | 'showing' (anuncio de verdade) | 'simulating' (sem SDK).
 */
export default function useAds() {
  const [adState, setAdState] = useState('idle');
  const [adSeconds, setAdSeconds] = useState(0);
  const busyRef = useRef(false);

  // Contagem regressiva da propaganda simulada.
  useEffect(() => {
    if (adState !== 'simulating') return undefined;
    const id = setInterval(() => setAdSeconds((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [adState]);

  // Silencia o jogo enquanto o anuncio estiver na frente.
  useEffect(() => {
    audio.setSuspended(adState !== 'idle');
    return () => audio.setSuspended(false);
  }, [adState]);

  /**
   * Roda um anuncio de verdade ou, quando nao ha nenhum possivel, a propaganda
   * simulada.
   *
   * Devolve `rewarded` (ganhou o premio), `shown` (o anuncio chegou a aparecer)
   * e `busy` (ja havia outro em andamento). Os tres importam: nao ter ganho
   * porque o jogador fechou o video no meio e uma coisa; nao ter ganho porque o
   * anuncio nem carregou e outra bem diferente.
   */
  const run = useCallback(async (kind, showReal) => {
    if (busyRef.current) return { shown: false, rewarded: false, busy: true };
    busyRef.current = true;
    try {
      if (ads.availability(kind).available) {
        setAdState('showing');
        const result = await showReal();
        setAdState('idle');
        return { shown: Boolean(result.shown), rewarded: Boolean(result.rewarded), busy: false };
      }
      if (ads.SIMULATE_WHEN_UNAVAILABLE) {
        setAdState('simulating');
        setAdSeconds(Math.ceil(ads.SIMULATED_DURATION / 1000));
        await new Promise((resolve) => setTimeout(resolve, ads.SIMULATED_DURATION));
        setAdState('idle');
        return { shown: true, rewarded: true, busy: false };
      }
      return { shown: false, rewarded: false, busy: false };
    } finally {
      busyRef.current = false;
    }
  }, []);

  /** Video premiado: o jogador escolheu assistir para ganhar alguma coisa. */
  const showRewarded = useCallback(() => run('rewarded', ads.showRewarded), [run]);

  /**
   * Intersticial: a pausa entre fases. Nao tem premio nem botao de recusa, e
   * por isso so pode aparecer em transicao de verdade — nunca por cima de um
   * toque que o jogador deu esperando outra coisa.
   */
  const showInterstitial = useCallback(() => run('interstitial', ads.showInterstitial), [run]);

  /**
   * Para a recompensa de que o jogo DEPENDE (as vidas). Alem do premio normal,
   * libera quando o video NAO chegou a aparecer: sem SDK, sem IDs, na web, sem
   * rede ou com o anuncio ainda carregando. Nada disso e escolha do jogador, e
   * anuncio nao pode ser a unica porta de saida de uma tela.
   *
   * O unico caso que nao libera e o que E escolha dele: abrir o video e fechar
   * antes do fim. Ai a regra do AdMob vale — sem assistir, sem premio.
   */
  const showRewardedOrGrant = useCallback(async () => {
    if (!ads.canShow('rewarded')) return true;
    const { rewarded, shown, busy } = await showRewarded();
    if (busy) return false;
    return rewarded || !shown;
  }, [showRewarded]);

  return { adState, adSeconds, showRewarded, showRewardedOrGrant, showInterstitial };
}

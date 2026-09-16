import { useCallback, useEffect, useRef, useState } from 'react';

import audio from '../audio/AudioManager';
import ads, { USE_TEST_UNITS } from '../services/ads';
import economy from '../services/economy';

/**
 * O video premiado visto pela tela: em que pe ele esta e o premio que ele rende.
 *
 * Tres coisas que todas as telas precisam do MESMO jeito: enquanto nao houver
 * SDK e IDs do AdMob, roda a propaganda simulada (so em desenvolvimento); o
 * audio do jogo cala enquanto o anuncio esta na frente; e o premio so vale
 * depois que o servidor confirma.
 *
 * `adState`: 'idle' | 'showing' (anuncio de verdade) | 'simulating' (sem SDK)
 *            | 'confirming' (video terminou, esperando o servidor registrar)
 */
export default function useAds() {
  const [adState, setAdState] = useState('idle');
  const [adSeconds, setAdSeconds] = useState(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const setStateSafe = useCallback((value) => {
    if (mountedRef.current) setAdState(value);
  }, []);

  // Contagem regressiva da propaganda simulada.
  useEffect(() => {
    if (adState !== 'simulating') return undefined;
    const id = setInterval(() => setAdSeconds((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [adState]);

  // Silencia o jogo enquanto o anuncio (ou a confirmacao) estiver na frente.
  useEffect(() => {
    audio.setSuspended(adState !== 'idle');
    return () => audio.setSuspended(false);
  }, [adState]);

  /**
   * Roda o video de verdade ou, quando nao ha nenhum possivel, a propaganda
   * simulada. Devolve `rewarded` (chegou ao fim), `shown` (chegou a aparecer),
   * `busy` (ja havia outro em andamento) e `testAd` (era anuncio de teste ou
   * simulado — esse nunca gera o aviso do Google ao servidor).
   */
  const play = useCallback(async () => {
    if (busyRef.current) return { shown: false, rewarded: false, busy: true, testAd: false };
    busyRef.current = true;
    try {
      if (ads.availability('rewarded').available) {
        setStateSafe('showing');
        const result = await ads.showRewarded();
        setStateSafe('idle');
        return {
          shown: Boolean(result.shown),
          rewarded: Boolean(result.rewarded),
          busy: false,
          testAd: USE_TEST_UNITS,
        };
      }
      if (ads.SIMULATE_WHEN_UNAVAILABLE) {
        setStateSafe('simulating');
        if (mountedRef.current) setAdSeconds(Math.ceil(ads.SIMULATED_DURATION / 1000));
        await new Promise((resolve) => setTimeout(resolve, ads.SIMULATED_DURATION));
        setStateSafe('idle');
        return { shown: true, rewarded: true, busy: false, testAd: true };
      }
      return { shown: false, rewarded: false, busy: false, testAd: false };
    } finally {
      busyRef.current = false;
    }
  }, [setStateSafe]);

  /**
   * Video premiado + premio registrado no servidor: 'lives', 'shield' ou
   * 'continue'.
   *
   * O video termina aqui, mas o premio so existe quando o SERVIDOR confirma: o
   * Google avisa o servidor, e o app pede a troca, tentando por alguns segundos
   * enquanto o aviso nao chega. Com anuncio de teste o aviso nunca vem, e a
   * troca e tentada uma vez so (ver economy.claimAd). Devolve ok com a carteira
   * ja atualizada, ou o motivo em texto.
   */
  const watchAdFor = useCallback(
    async (kind) => {
      const { rewarded, shown, busy, testAd } = await play();
      if (busy) return { ok: false, error: null };
      if (!rewarded) {
        return {
          ok: false,
          error: shown
            ? 'O vídeo foi fechado antes do fim — sem prêmio desta vez.'
            : 'Nenhum anúncio disponível agora. Tente de novo em instantes.',
        };
      }
      setStateSafe('confirming');
      try {
        return await economy.claimAd(kind, { testAd });
      } finally {
        setStateSafe('idle');
      }
    },
    [play, setStateSafe]
  );

  return { adState, adSeconds, watchAdFor, canWatch: ads.canShow('rewarded') };
}

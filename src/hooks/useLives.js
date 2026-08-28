import { useEffect, useState } from 'react';

import {
  initLives,
  livesLoaded,
  livesNow,
  refillLives,
  spendLife,
  subscribeLives,
} from '../services/lives';

/**
 * As vidas do jogador, para quem precisa REDESENHAR quando elas mudam.
 *
 * A conta em si mora em `services/lives.js`, fora do React: quem so precisa
 * saber o numero na hora de decidir alguma coisa chama `livesNow()` e nao passa
 * por aqui. Este hook existe para a tela se redesenhar sozinha — e por isso ele
 * assina o servico em vez de guardar uma copia propria.
 */
export default function useLives() {
  const [state, setState] = useState(() => ({ lives: livesNow(), loaded: livesLoaded() }));

  useEffect(() => {
    const off = subscribeLives((lives, loaded) => setState({ lives, loaded }));
    // Idempotente: so a primeira tela a montar realmente le o disco.
    initLives().catch(() => {});
    // Entre a montagem e a assinatura o numero pode ter mudado.
    setState({ lives: livesNow(), loaded: livesLoaded() });
    return off;
  }, []);

  return { lives: state.lives, loaded: state.loaded, spend: spendLife, refill: refillLives };
}

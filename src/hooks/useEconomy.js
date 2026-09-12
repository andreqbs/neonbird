import { useEffect, useState } from 'react';

import { economyNow, refresh, subscribeEconomy } from '../services/economy';

/**
 * A economia para quem precisa REDESENHAR quando ela muda: carteira, catalogo e
 * se ha servidor. O estado mora em `services/economy.js`, fora do React; o hook
 * so assina.
 *
 * Na primeira tela que monta, ja dispara a busca no servidor.
 */
export default function useEconomy() {
  const [snapshot, setSnapshot] = useState(economyNow);

  useEffect(() => {
    const off = subscribeEconomy(setSnapshot);
    setSnapshot(economyNow());
    if (economyNow().status === 'idle') refresh();
    return off;
  }, []);

  return snapshot;
}

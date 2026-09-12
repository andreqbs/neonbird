import { useCallback, useEffect, useState } from 'react';

import ads from '../services/ads';
import cloud from '../services/cloud';
import {
  initPlayer,
  playerLoaded,
  playerNow,
  renamePlayer,
  subscribePlayer,
} from '../services/identity';

/**
 * O jogador deste aparelho, para quem precisa REDESENHAR quando ele muda.
 *
 * A identidade em si mora em `services/identity.js`, fora do React — quem so
 * precisa do codigo na hora de chamar o servidor usa `playerNow()`. Este hook
 * existe para a tela acompanhar o apelido e, na abertura, fazer as duas coisas
 * que dependem do jogador existir: avisar o servidor e entregar o codigo aos
 * videos premiados (e por ele que o Google confirma o premio ao servidor).
 */
export default function usePlayer() {
  const [state, setState] = useState(() => ({ player: playerNow(), loaded: playerLoaded() }));

  useEffect(() => {
    const off = subscribePlayer((player, loaded) => setState({ player, loaded }));
    initPlayer()
      .then((player) => {
        if (player) ads.setRewardUser(player.id);
        cloud.syncPlayer();
      })
      .catch(() => {});
    setState({ player: playerNow(), loaded: playerLoaded() });
    return off;
  }, []);

  /** Troca o apelido aqui e la. Devolve o nome aceito, ou null se nao servia. */
  const rename = useCallback((name) => {
    const aceito = renamePlayer(name);
    if (aceito) cloud.syncPlayer();
    return aceito;
  }, []);

  return { player: state.player, loaded: state.loaded, rename };
}

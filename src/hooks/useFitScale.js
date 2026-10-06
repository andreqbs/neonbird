import { useCallback, useEffect, useState } from 'react';

/** Abaixo disso o texto fica pequeno demais para ler — e nenhum celular chega la. */
export const MIN_SCALE = 0.45;

/**
 * Faz um bloco de tela caber numa altura, sem rolagem: devolve a escala (de
 * MIN_SCALE a 1) que a tela aplica nas fontes, na arte e nos espacos.
 *
 * Como mede: o bloco informa a altura que ocupou (`onLayout`); se passou da
 * altura disponivel, a escala diminui na mesma proporcao, e o bloco e medido de
 * novo. Encolher letra so reduz quebra de linha, entao a altura cai pelo menos
 * na proporcao — em uma ou duas medidas a escala assenta. Se sobra espaco, ela
 * volta para 1 (o tamanho de projeto, nunca maior).
 *
 * `key` e o que muda o tamanho do conteudo sem mudar a tela (o idioma, um aviso
 * que apareceu): mudou, mede de novo a partir de 1.
 *
 * Enquanto a primeira medida nao chega, `ready` e falso: a tela fica invisivel
 * nesse instante, para ninguem ver o tamanho grande piscar antes de encolher.
 */
export default function useFitScale(available, key) {
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setScale(1);
    setReady(false);
  }, [available, key]);

  const onLayout = useCallback(
    (e) => {
      const altura = e.nativeEvent.layout.height;
      if (!altura || !available) return;
      setScale((atual) => {
        const alvo = Math.min(1, Math.max(MIN_SCALE, (atual * available) / altura));
        // Folga de 1%: sem ela, arredondamento de pixel faria a escala oscilar.
        if (alvo < atual) return alvo;
        return alvo - atual > 0.01 ? alvo : atual;
      });
      setReady(true);
    },
    [available]
  );

  return { scale, ready, onLayout };
}

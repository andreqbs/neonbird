import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Abaixo disso o texto fica pequeno demais para ler — e nenhum celular chega la. */
export const MIN_SCALE = 0.45;

/**
 * Prazo da primeira medida. Se ela nao chegar ate la, a tela aparece assim
 * mesmo: um conteudo um pouco grande e melhor do que uma tela vazia.
 */
export const REVEAL_TIMEOUT_MS = 350;

/**
 * A escala seguinte, dada a ultima medida do bloco. Conta pura, sem React — o
 * `npm test` passa por ela.
 *
 *   atual        a escala em uso
 *   medida       { altura, escala }: a altura que o bloco ocupou e a escala com
 *                que ele estava desenhado quando foi medido
 *   disponivel   a altura que cabe
 *   podeCrescer  se ainda da para crescer nesta rodada de medidas
 *
 * Encolher e sempre permitido. Crescer, uma vez por rodada: letra menor quebra
 * menos linha, entao a conta pode mandar crescer, o texto voltar a quebrar e a
 * conta mandar encolher de novo — sem o limite, a tela pularia entre as duas
 * escalas para sempre.
 */
export function nextFitScale(atual, medida, disponivel, podeCrescer) {
  if (!medida || !(medida.altura > 0) || !(disponivel > 0)) return atual;
  const alvo = Math.min(1, Math.max(MIN_SCALE, (medida.escala * disponivel) / medida.altura));
  if (alvo < atual - 0.001) return alvo;
  // Folga de 1%: sem ela, arredondamento de pixel faria a escala oscilar.
  if (podeCrescer && alvo - atual > 0.01) return alvo;
  return atual;
}

// A ultima escala de cada altura disponivel. A Home monta de novo a cada volta
// (partida, loja, ranking): com a escala de antes ela ja nasce no tamanho certo
// e visivel, sem esperar medida nenhuma.
const lembradas = new Map();

/**
 * Faz um bloco de tela caber numa altura, sem rolagem: devolve a escala (de
 * MIN_SCALE a 1) que a tela aplica nas fontes, na arte e nos espacos.
 *
 * Como mede: o bloco informa a altura que ocupou (`onLayout`); se passou da
 * altura disponivel, a escala diminui na mesma proporcao e o bloco e medido de
 * novo. Encolher letra so reduz quebra de linha, entao a altura cai pelo menos
 * na proporcao — em uma ou duas medidas a escala assenta. Se sobra espaco, ela
 * cresce de volta (ate 1, o tamanho de projeto, nunca maior).
 *
 * `key` e o que muda o tamanho do conteudo sem mudar a tela (o idioma, um aviso
 * que apareceu): mudou, abre uma rodada nova, em que a escala pode crescer de
 * novo.
 *
 * `ready` e falso so antes da primeira medida — a tela fica invisivel nesse
 * instante, para ninguem ver o tamanho grande piscar antes de encolher. Uma vez
 * verdadeiro, NUNCA volta a falso: `onLayout` so dispara quando o tamanho muda,
 * e esconder a tela esperando uma medida que pode nao vir e o que deixava a
 * Home so com o fundo. Mesmo a primeira medida tem prazo (REVEAL_TIMEOUT_MS).
 */
export default function useFitScale(available, key) {
  const [scale, setScale] = useState(() => lembradas.get(available) ?? 1);
  const [ready, setReady] = useState(() => lembradas.has(available));

  // O que os eventos de medida leem na hora, sem esperar um render.
  const atual = useRef(scale); // a escala pedida por ultimo
  const desenhada = useRef(scale); // a escala do ultimo desenho que chegou a tela
  const medida = useRef(null); // a ultima medida: { altura, escala }
  const rodada = useRef({ available, key, cresceu: false });

  const aplica = useCallback(() => {
    const r = rodada.current;
    const nova = nextFitScale(atual.current, medida.current, r.available, !r.cresceu);
    if (nova === atual.current) return;
    if (nova > atual.current) r.cresceu = true;
    atual.current = nova;
    setScale(nova);
  }, []);

  // Depois de cada desenho: guarda a escala com que ele saiu — a medida que vier
  // em seguida e dele. E, se ja houve medida, lembra dela para a proxima vez que
  // a tela montar (escala que ninguem conferiu nao vale como lembranca).
  useLayoutEffect(() => {
    desenhada.current = scale;
    if (medida.current) lembradas.set(available, scale);
  });

  // Mudou a tela ou o conteudo: rodada nova, refeita na hora com a ultima
  // medida. A altura disponivel pode mudar sem o bloco mudar de tamanho, e ai
  // nenhuma medida nova viria. E efeito de layout de proposito: roda junto com
  // o desenho, antes de qualquer medida dele — um efeito comum podia rodar
  // DEPOIS da medida e desfazer a conta.
  useLayoutEffect(() => {
    const r = rodada.current;
    if (r.available === available && r.key === key) return;
    rodada.current = { available, key, cresceu: false };
    aplica();
  }, [available, key, aplica]);

  // Rede de seguranca: sem a primeira medida no prazo, aparece assim mesmo.
  useEffect(() => {
    if (ready) return undefined;
    const id = setTimeout(() => setReady(true), REVEAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [ready]);

  const onLayout = useCallback(
    (e) => {
      const altura = e?.nativeEvent?.layout?.height;
      if (altura > 0) {
        medida.current = { altura, escala: desenhada.current };
        aplica();
      }
      setReady(true);
    },
    [aplica]
  );

  return { scale, ready, onLayout };
}

/**
 * Habilidades dos passaros.
 *
 * Ainda nao ha nenhuma definida — mas o lugar delas ja existe, e e aqui. Cada
 * passaro da loja chega do servidor com `ability: { id, status }` (o de sempre
 * vem com `ability: null`), e o mundo do jogo (World.js) chama os ganchos da
 * habilidade do passaro escolhido nos momentos certos:
 *
 *   onRunStart(world)        partida nova
 *   onStageStart(world)      fase nova
 *   onFrame(world)           cada passo de simulacao, com o voo rolando
 *   onCoin(world, pillar)    pegou a moeda do obstaculo `pillar`
 *   onHit(world, what)       bateu sem escudo ('pillar' ou 'ground'). Devolver
 *                            true perdoa a batida — e ai e a habilidade quem
 *                            tira o passaro do perigo, senao ele bate de novo
 *                            no frame seguinte
 *   onRevive(world)          voltou com a nova chance
 *
 * Todos sao opcionais: entrada sem gancho nenhum e um passaro so de visual,
 * que e o que os cinco sao hoje.
 *
 * ATENCAO ao dar vida a uma habilidade: se ela mexer em moeda ou pontuacao
 * (moeda em dobro, ima de moedas...), a mesma regra precisa entrar no servidor
 * (server/catalog.go e a conferencia de server/economy.go). O servidor confere
 * cada partida pela regra DELE — sem isso, ele recusa o que a habilidade rendeu.
 */

export const NO_ABILITY = Object.freeze({ id: null });

const ABILITIES = {
  frost: { id: 'frost' },
  ember: { id: 'ember' },
  toxic: { id: 'toxic' },
  phantom: { id: 'phantom' },
  comet: { id: 'comet' },
};

/** A habilidade de um passaro do catalogo — ou nenhuma, para o de sempre. */
export function abilityFor(bird) {
  const id = bird && bird.ability && bird.ability.id;
  return (id && ABILITIES[id]) || NO_ABILITY;
}

// Passo fixo de simulacao (60 Hz). Manter o delta constante deixa a fisica
// deterministica e evita o "delta correction" instavel do matter-js.
export const FIXED_DT = 1000 / 60;

// Quantos passos no maximo podem ser recuperados num unico frame,
// para o jogo nao "teleportar" depois de um travamento ou app em background.
export const MAX_STEPS_PER_FRAME = 6;

export const PHASE = {
  READY: 'ready',
  PLAYING: 'playing',
  STAGE_CLEAR: 'stage-clear', // fase concluida: mundo congelado, esperando o anuncio
  OVER: 'over',
};

/**
 * Quantos obstaculos passam ate fechar uma fase.
 *
 * TESTE: 10, para dar para ver a troca de fase e o anuncio em poucos segundos.
 * PRODUCAO: volte para 50 — e o unico numero que precisa mudar.
 */
export const STAGE_LENGTH = 10;

/**
 * Quanto tempo o escudo leva para se dissipar depois da primeira batida, em
 * frames de 60 Hz (90 = 1,5 s).
 *
 * Ele nao some no instante do impacto: vai apagando, e ENQUANTO houver anel na
 * tela toda colisao continua sendo perdoada — a outra coluna do mesmo par, a
 * coluna seguinte ou o chao. E tempo de sobra para a coluna que acertou o
 * passaro sair da frente, e agora o jogador ve quanto de perdao ainda lhe resta
 * em vez de contar com uma invulnerabilidade invisivel.
 */
export const SHIELD_FADE_FRAMES = 90;

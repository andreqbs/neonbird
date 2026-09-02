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
 * E o unico numero que separa uma partida de teste de uma partida de verdade:
 * baixe para 10 quando quiser ver as cinco fases (e os dois anuncios) em poucos
 * minutos, e devolva para 100 antes de gerar a build.
 */
export const STAGE_LENGTH = 100;

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

/**
 * ARMADILHA DE GELO (fases com `traps.ice`).
 *
 * Os tempos sao em SEGUNDOS DE DISTANCIA, nao em pixels: assim o aviso dura o
 * mesmo tanto em qualquer fase — quanto mais rapida a coluna vem, mais longe
 * ela comeca a piscar.
 */
export const ICE_WARN_SECONDS = 1.2; // com quanta antecedencia o cano pisca
export const ICE_OUT_SECONDS = 0.45; // quando o gelo comeca a sair de fato
export const ICE_GROW_FRAMES = 16; // frames ate o bloco sair inteiro
export const ICE_GAP_BITE = 0.15; // fatia do vao que o gelo come
export const ICE_CHANCE = 0.55; // quantas colunas, em media, trazem a armadilha

/**
 * GRAVIDADE AUMENTADA (fases com `traps.heavy`).
 *
 * Dobrar a gravidade nao muda o impulso do toque: o mesmo toque passa a subir
 * metade do que subia, e e isso que faz o jogador precisar tocar mais.
 */
export const HEAVY_MULT = 2;
export const HEAVY_FRAMES = [170, 290]; // ~2,8 a 4,8 s de peso
export const HEAVY_INTERVAL = [330, 690]; // ~5,5 a 11,5 s de folga entre eles

/**
 * Quanto tempo a seta vermelha aparece no canto ANTES de o peso entrar.
 *
 * Sem esse aviso a gravidade dobraria no meio de uma passagem apertada e o
 * jogador so descobriria caindo. Dois segundos e o bastante para ele subir um
 * pouco e se preparar — e e por isso que o aviso vem antes, e nao junto.
 */
export const HEAVY_WARN_FRAMES = 120;

/**
 * VAO QUE SE MEXE (fases com `traps.drift`).
 *
 * O par inteiro desliza na vertical mantendo o TAMANHO do vao: o cano de cima
 * cresce exatamente o que o de baixo encolhe. O jogador nao ganha nem perde
 * espaco — ele so nao pode mais decorar a altura da passagem.
 *
 * A antecedencia e medida em DISTANCIA, e nao em quantidade de obstaculos.
 * Contar obstaculos nao funcionou: quando o passaro cruza uma coluna, a
 * seguinte ja esta a dois espacamentos, e cabe pouco mais de uma coluna na tela
 * a frente dele — o movimento acontecia inteiro fora do quadro e a armadilha
 * parecia sorteio de altura.
 *
 * Agora a coluna comeca a deslizar no frame em que ENTRA pela direita, e para
 * quando chega a DRIFT_SAFE_SECONDS de viagem do passaro. Assim o jogador ve o
 * movimento acontecer e ainda tem um segundo inteiro com a coluna parada para
 * se posicionar.
 */
export const DRIFT_SAFE_SECONDS = 1; // silencio obrigatorio antes da coluna chegar
export const DRIFT_CHANCE = 0.8; // quase toda coluna se mexe
export const DRIFT_FRAMES = 36; // ~0,6 s deslizando, para caber na janela visivel
export const DRIFT_MIN_STEP = 0.28; // fatia minima da faixa util, para se notar

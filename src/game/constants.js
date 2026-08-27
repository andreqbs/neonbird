// Passo fixo de simulacao (60 Hz). Manter o delta constante deixa a fisica
// deterministica e evita o "delta correction" instavel do matter-js.
export const FIXED_DT = 1000 / 60;

// Quantos passos no maximo podem ser recuperados num unico frame,
// para o jogo nao "teleportar" depois de um travamento ou app em background.
export const MAX_STEPS_PER_FRAME = 6;

export const PHASE = {
  READY: 'ready',
  PLAYING: 'playing',
  OVER: 'over',
};

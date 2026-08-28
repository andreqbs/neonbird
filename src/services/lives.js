import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@major-flyer/lives';

/** Quantas partidas o jogador comeca antes de precisar do video premiado. */
export const MAX_LIVES = 5;

/**
 * Vidas do jogador.
 *
 * O numero vive na MEMORIA — e ela a fonte da verdade enquanto o app roda; o
 * disco so guarda entre uma sessao e outra, senao fechar o app seria a maneira
 * mais facil de jogar para sempre.
 *
 * Foi essa separacao que matou um bug: quando cada mudanca dependia de uma ida
 * e volta ao AsyncStorage para so entao voltar para a tela por props, dava para
 * comecar uma partida e o painel ainda mostrar o numero velho. No Android, com
 * a thread de JS ocupada pelo jogo, esse atraso passava de segundos.
 *
 * Agora `spendLife()` e `refillLives()` mudam o numero na hora e avisam quem
 * estiver ouvindo; a gravacao vai atras, numa fila, para o disco nunca guardar
 * uma ordem diferente da que aconteceu na tela.
 */

export function sanitize(n) {
  if (!Number.isFinite(n)) return MAX_LIVES;
  return Math.max(0, Math.min(MAX_LIVES, Math.floor(n)));
}

// --------------------------------------------------------------------- disco

export async function loadLives() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null || raw === undefined) return MAX_LIVES; // primeira vez
    return sanitize(parseInt(raw, 10));
  } catch (e) {
    // Sem disco nao e motivo para impedir alguem de jogar.
    return MAX_LIVES;
  }
}

export async function saveLives(n) {
  const value = sanitize(n);
  try {
    await AsyncStorage.setItem(KEY, String(value));
  } catch (e) {
    // Sem espaco: o numero da sessao ainda vale.
  }
  return value;
}

// -------------------------------------------------------------------- memoria

let current = MAX_LIVES;
let loaded = false;
let touched = false; // alguem ja gastou ou recarregou nesta sessao?
let writing = Promise.resolve();
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener(current, loaded);
}

/** Enfileira a gravacao. Serializada para o disco seguir a mesma ordem. */
function persist() {
  writing = writing.then(() => saveLives(current)).catch(() => {});
  return writing;
}

/** Quantas vidas AGORA, sem esperar disco nenhum. */
export function livesNow() {
  return current;
}

/** O disco ja respondeu? Antes disso o numero na tela e so um chute otimista. */
export function livesLoaded() {
  return loaded;
}

export function subscribeLives(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Leitura inicial, uma vez por sessao.
 *
 * Se o jogador ja tiver gastado uma vida antes de o disco responder (e sao
 * milissegundos, mas acontece), o valor da memoria e o mais novo: o disco
 * chegando atrasado nao pode devolver a vida gasta.
 */
export async function initLives() {
  if (loaded) return current;
  const disk = await loadLives();
  if (!touched) current = disk;
  loaded = true;
  emit();
  return current;
}

/** Comecar uma partida custa uma vida. */
export function spendLife() {
  touched = true;
  current = sanitize(current - 1);
  emit();
  persist();
  return current;
}

/** Recompensa do video premiado: as cinco de volta. */
export function refillLives() {
  touched = true;
  current = MAX_LIVES;
  emit();
  persist();
  return current;
}

/** So para os testes: devolve o modulo ao estado de app recem-aberto. */
export function resetLivesState() {
  current = MAX_LIVES;
  loaded = false;
  touched = false;
  writing = Promise.resolve();
  listeners.clear();
}

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Ponte com o Google Play Jogos (Play Games Services), que e o que da o ranking
 * com outros jogadores com conta na Play Store.
 *
 * IMPORTANTE — leia antes de esperar nomes reais na tela de ranking:
 *
 * Play Games Services e codigo NATIVO Android. Nao existe e nao pode existir no
 * Expo Go, que e um app pronto na loja: seria preciso que o Expo Go fosse o SEU
 * jogo, registrado no SEU Play Console, com a SUA assinatura. Entao aqui o
 * modulo nativo e OPCIONAL: se ele nao estiver presente, o app funciona
 * normalmente com o ranking local e a interface diz o que falta.
 *
 * Para ativar de verdade (resumo; passo a passo no README):
 *   1. `npx create-expo-module --local neon-flyer-play-games`
 *   2. No Kotlin do modulo, use `com.google.android.gms:play-services-games-v2`
 *      e exponha os metodos que este arquivo espera (veja CONTRATO abaixo).
 *   3. Cadastre o jogo e um placar no Google Play Console e cole o ID em
 *      LEADERBOARD_ID.
 *   4. `npx expo prebuild` + `eas build -p android` (nao roda mais no Expo Go).
 *
 * CONTRATO do modulo nativo (nome registrado: "NeonFlyerPlayGames"):
 *   isAvailable(): boolean
 *   signInAsync(): Promise<{ signedIn: boolean, playerName?: string, playerId?: string }>
 *   getPlayerAsync(): Promise<{ signedIn: boolean, playerName?: string, playerId?: string }>
 *   submitScoreAsync(leaderboardId: string, score: number): Promise<void>
 *   loadTopScoresAsync(leaderboardId: string, limit: number):
 *     Promise<{ rank: number, name: string, score: number, isPlayer: boolean }[]>
 *   showLeaderboardAsync(leaderboardId: string): Promise<void>
 */

// Cole aqui o ID gerado no Play Console (algo como "CgkI8...QAQ").
export const LEADERBOARD_ID = '';

const Native = requireOptionalNativeModule('NeonFlyerPlayGames');

export const UNAVAILABLE_REASON = {
  PLATFORM: 'platform', // iOS/web: Play Jogos e so Android
  NO_NATIVE_MODULE: 'no-native-module', // Expo Go ou build sem o modulo
  NO_LEADERBOARD_ID: 'no-leaderboard-id', // modulo presente, placar nao cadastrado
};

export function isSupportedPlatform() {
  return Platform.OS === 'android';
}

/** O ranking global so e utilizavel se as tres condicoes baterem. */
export function availability() {
  if (!isSupportedPlatform()) return { available: false, reason: UNAVAILABLE_REASON.PLATFORM };
  if (!Native) return { available: false, reason: UNAVAILABLE_REASON.NO_NATIVE_MODULE };
  if (!LEADERBOARD_ID) return { available: false, reason: UNAVAILABLE_REASON.NO_LEADERBOARD_ID };
  return { available: true, reason: null };
}

const OFFLINE_PLAYER = { signedIn: false, playerName: null, playerId: null };

/**
 * Estado da conta. O Play Games v2 tenta entrar sozinho quando o jogo abre,
 * entao na maioria das vezes isso ja volta conectado sem o usuario fazer nada —
 * e por isso que o botao "Conectar" em Configuracoes e opcional, e nao um login
 * obrigatorio na abertura.
 */
export async function getPlayer() {
  if (!availability().available) return OFFLINE_PLAYER;
  try {
    const p = await Native.getPlayerAsync();
    return { ...OFFLINE_PLAYER, ...p };
  } catch (e) {
    return OFFLINE_PLAYER;
  }
}

/** Login manual, para quem recusou o automatico ou trocou de conta. */
export async function signIn() {
  if (!availability().available) return OFFLINE_PLAYER;
  try {
    const p = await Native.signInAsync();
    return { ...OFFLINE_PLAYER, ...p };
  } catch (e) {
    return OFFLINE_PLAYER;
  }
}

/** Envia o placar. Silencioso de proposito: nunca deve atrapalhar o fim de jogo. */
export async function submitScore(score) {
  if (!availability().available || score <= 0) return false;
  try {
    await Native.submitScoreAsync(LEADERBOARD_ID, score);
    return true;
  } catch (e) {
    return false;
  }
}

/** Top N do placar publico. */
export async function loadTopScores(limit = 25) {
  if (!availability().available) return [];
  try {
    const rows = await Native.loadTopScoresAsync(LEADERBOARD_ID, limit);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

/** Abre a interface nativa do Play Jogos, quando disponivel. */
export async function showNativeLeaderboard() {
  if (!availability().available) return false;
  try {
    await Native.showLeaderboardAsync(LEADERBOARD_ID);
    return true;
  } catch (e) {
    return false;
  }
}

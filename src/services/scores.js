import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * As chaves do historico de partidas que as versoes antigas guardavam no
 * aparelho (a primeira, de quando o jogo se chamava Neon Flyer). O recorde e a
 * aba "Seus voos" agora vem do servidor — das partidas fechadas la —, entao o
 * que sobrou no disco so ocupa espaco.
 */
export const LOCAL_RUNS_KEYS = ['@major-flyer/runs', '@neon-flyer/runs', '@neon-flyer/best'];

/** Apaga o historico local antigo. Sem disco, fica para a proxima abertura. */
export async function forgetLocalRuns() {
  try {
    await AsyncStorage.multiRemove(LOCAL_RUNS_KEYS);
  } catch (e) {
    // nada a fazer
  }
}

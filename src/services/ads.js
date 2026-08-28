import { Platform } from 'react-native';

import loadSdk from './adsSdk';

/**
 * Anuncios (AdMob).
 *
 * O jogo NAO depende de anuncio para funcionar: sem SDK, sem IDs ou na web,
 * todas as funcoes daqui respondem "nao deu" na hora e a partida segue. Nada de
 * tela travada esperando um anuncio que nunca vem.
 *
 * ----------------------------------------------------------------------------
 * ESTADO: conta do AdMob criada e ligada nas duas plataformas.
 *
 *   ANDROID  App ID ....... ca-app-pub-6744388004633498~5213266367  (app.json)
 *            Rewarded ..... ca-app-pub-6744388004633498/7044011331
 *            Intersticial . ca-app-pub-6744388004633498/9670174671
 *
 *   iOS      App ID ....... ca-app-pub-6744388004633498~9033091878  (app.json)
 *            Rewarded ..... ca-app-pub-6744388004633498/7720010204
 *            Intersticial . ainda nao criado no AdMob
 *
 * Os App IDs moram no app.json (props do plugin), porque quem precisa deles e o
 * codigo NATIVO — vao para o AndroidManifest e para o Info.plist. As unidades
 * moram aqui, em AD_UNITS.
 *
 * FALTA no iOS so o intersticial: enquanto ele nao existir, a troca de fase no
 * iPhone acontece sem anuncio (o escudo, que e premiado, funciona normalmente).
 *
 * Anuncio e codigo nativo: nao roda no Expo Go nem na web. Depois de mexer no
 * app.json, `npx expo prebuild --clean` e uma build de verdade (`eas build` ou
 * `npx expo run:android`).
 *
 * ----------------------------------------------------------------------------
 * NOTA DE POLITICA (importante para a conta nao ser suspensa):
 *
 * Anuncio PREMIADO (rewarded) exige que o jogador ESCOLHA assistir e receba
 * algo em troca. Obrigar a ver um video premiado para continuar e violacao —
 * o formato certo para uma pausa obrigatoria e o INTERSTICIAL.
 *
 * Por isso a tela de fim de fase oferece as duas saidas: assistir (e ganhar o
 * escudo) ou seguir direto. Se um dia quiser a pausa obrigatoria, chame
 * `showInterstitial()` no lugar — o contrato ja esta pronto.
 */

// ---------------------------------------------------------------- configuracao

/**
 * IDs de teste oficiais do Google. Servem para ver o fluxo funcionando antes de
 * ter conta. NUNCA suba para a loja com eles ligados: clique em anuncio de
 * teste nao paga, e clique em anuncio real feito por voce derruba a conta.
 */
const TEST_UNITS = {
  android: {
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    banner: 'ca-app-pub-3940256099942544/6300978111',
  },
  ios: {
    rewarded: 'ca-app-pub-3940256099942544/1712485313',
    interstitial: 'ca-app-pub-3940256099942544/4411468910',
    banner: 'ca-app-pub-3940256099942544/2934735716',
  },
};

/** As unidades da conta. Vazio = aquele formato ainda nao existe na conta. */
export const AD_UNITS = {
  android: {
    rewarded: 'ca-app-pub-6744388004633498/7044011331',
    interstitial: 'ca-app-pub-6744388004633498/9670174671',
    banner: '',
  },
  ios: {
    rewarded: 'ca-app-pub-6744388004633498/7720010204',
    // Bloco intersticial de iOS ainda nao criado no AdMob: sem ele a troca de
    // fase no iPhone segue direto, sem anuncio nenhum.
    interstitial: '',
    banner: '',
  },
};

/**
 * Unidade de teste em desenvolvimento, unidade real so na build de producao.
 *
 * Esta e a linha que protege a conta: clicar num anuncio REAL do proprio app —
 * coisa que acontece sozinha enquanto se testa — e o jeito mais rapido de o
 * AdMob suspender o pagamento. Com `__DEV__`, todo `expo start` e toda build de
 * debug mostram o anuncio de teste do Google, e a build de release mostra o de
 * verdade, sem ninguem precisar lembrar de trocar nada.
 *
 * Para conferir o anuncio real antes de publicar, troque para `false` numa
 * build sua e NAO clique no anuncio (assistir ate o fim pode; clicar, nao).
 */
export const USE_TEST_UNITS = typeof __DEV__ === 'undefined' ? true : __DEV__;

/**
 * Onde nao ha anuncio possivel — na web, no Expo Go, num formato que a conta
 * ainda nao tem — o jogo mostra uma pausa curta no lugar do video. E o que
 * permite testar o fluxo inteiro (fim de fase e recarga de vidas) no navegador.
 *
 * So em DESENVOLVIMENTO, e por um motivo serio: essa pausa e uma propaganda de
 * mentira. Mostra-la a quem baixou o jogo seria enganar o jogador com uma tela
 * de anuncio que nao e anuncio nenhum. Na build de producao, formato que nao
 * existe simplesmente nao aparece — a fase troca direto.
 */
export const SIMULATE_WHEN_UNAVAILABLE = typeof __DEV__ === 'undefined' ? true : __DEV__;
export const SIMULATED_DURATION = 3000; // ms da propaganda de mentira

// ------------------------------------------------------------------- interno

// O SDK e opcional e mora atras de `adsSdk`, que tem uma versao `.web.js`
// devolvendo null — sem essa separacao o bundle da web nem compila.
const Sdk = loadSdk();

export const UNAVAILABLE_REASON = {
  PLATFORM: 'platform', // web: AdMob e so celular
  NO_SDK: 'no-sdk', // biblioteca nao instalada / Expo Go
  NO_UNIT_ID: 'no-unit-id', // biblioteca ok, unidade nao cadastrada
};

function unitId(kind) {
  const key = Platform.OS === 'ios' ? 'ios' : 'android';
  const real = AD_UNITS[key][kind] || '';

  // Sem unidade real cadastrada, aquela plataforma ainda nao existe no AdMob —
  // e o app nativo dela tambem nao tem o App ID no manifesto. Devolver a
  // unidade de TESTE aqui faria o app inicializar o SDK sem App ID, que e um
  // crash nativo na abertura. Melhor responder "nao ha anuncio" e cair na
  // simulacao, que e exatamente o caso do iOS hoje.
  if (!real) return '';

  return USE_TEST_UNITS ? TEST_UNITS[key][kind] : real;
}

/** Da para mostrar anuncio de verdade agora? */
export function availability(kind = 'rewarded') {
  if (Platform.OS === 'web') return { available: false, reason: UNAVAILABLE_REASON.PLATFORM };
  if (!Sdk) return { available: false, reason: UNAVAILABLE_REASON.NO_SDK };
  if (!unitId(kind)) return { available: false, reason: UNAVAILABLE_REASON.NO_UNIT_ID };
  return { available: true, reason: null };
}

/** Ha algo para mostrar ao jogador — anuncio de verdade ou a simulacao. */
export function canShow(kind = 'rewarded') {
  return availability(kind).available || SIMULATE_WHEN_UNAVAILABLE;
}

let initialized = false;
let rewardedAd = null;
let rewardedReady = false;
let interstitialAd = null;
let interstitialReady = false;

/** Chamado uma vez na abertura do app. Silencioso quando nao ha SDK. */
export async function initialize() {
  if (initialized || !availability().available) return false;
  initialized = true;
  try {
    await Sdk.default().initialize();
    preloadRewarded();
    preloadInterstitial();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Deixa o proximo video premiado carregando em segundo plano. Anuncio que so
 * comeca a carregar na hora do clique faz o jogador esperar olhando para nada.
 */
export function preloadRewarded() {
  if (!availability('rewarded').available) return;
  try {
    const { RewardedAd, RewardedAdEventType } = Sdk;
    rewardedReady = false;
    rewardedAd = RewardedAd.createForAdRequest(unitId('rewarded'), {
      requestNonPersonalizedAdsOnly: true,
    });
    rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedReady = true;
    });
    rewardedAd.load();
  } catch (e) {
    rewardedAd = null;
  }
}

/**
 * Mostra o video premiado.
 *
 * Sempre resolve — nunca rejeita e nunca fica pendurado: quem chama so precisa
 * saber se pode liberar a recompensa.
 *
 * @returns {Promise<{ shown: boolean, rewarded: boolean, simulated: boolean, reason: string|null }>}
 */
export async function showRewarded() {
  const { available, reason } = availability('rewarded');
  if (!available) {
    return { shown: false, rewarded: false, simulated: false, reason };
  }

  return new Promise((resolve) => {
    try {
      const { RewardedAdEventType, AdEventType } = Sdk;
      const ad = rewardedAd;
      if (!ad || !rewardedReady) {
        preloadRewarded(); // fica pronto para a proxima fase
        resolve({ shown: false, rewarded: false, simulated: false, reason: 'not-loaded' });
        return;
      }

      let earned = false;
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        unsubscribe();
        preloadRewarded();
        resolve(result);
      };

      const subs = [
        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          earned = true;
        }),
        ad.addAdEventListener(AdEventType.CLOSED, () =>
          finish({ shown: true, rewarded: earned, simulated: false, reason: null })
        ),
        ad.addAdEventListener(AdEventType.ERROR, () =>
          finish({ shown: false, rewarded: false, simulated: false, reason: 'error' })
        ),
      ];
      const unsubscribe = () => subs.forEach((off) => typeof off === 'function' && off());

      ad.show();
    } catch (e) {
      resolve({ shown: false, rewarded: false, simulated: false, reason: 'error' });
    }
  });
}

/** Mesmo raciocinio do premiado: carregar so no clique faz o jogador esperar. */
export function preloadInterstitial() {
  if (!availability('interstitial').available) return;
  try {
    const { InterstitialAd, AdEventType } = Sdk;
    interstitialReady = false;
    interstitialAd = InterstitialAd.createForAdRequest(unitId('interstitial'), {
      requestNonPersonalizedAdsOnly: true,
    });
    interstitialAd.addAdEventListener(AdEventType.LOADED, () => {
      interstitialReady = true;
    });
    interstitialAd.load();
  } catch (e) {
    interstitialAd = null;
  }
}

/**
 * Intersticial — a pausa entre fases. Mesmo contrato do premiado, sem
 * recompensa: sempre resolve, nunca fica pendurado.
 *
 * Anuncio que nao carregou nao segura o jogo: responde 'not-loaded' na hora e
 * ja pede o proximo. A troca de fase acontece do mesmo jeito.
 */
export async function showInterstitial() {
  const { available, reason } = availability('interstitial');
  if (!available) return { shown: false, simulated: false, reason };

  return new Promise((resolve) => {
    try {
      const { AdEventType } = Sdk;
      const ad = interstitialAd;
      if (!ad || !interstitialReady) {
        preloadInterstitial(); // fica pronto para a proxima fase
        resolve({ shown: false, simulated: false, reason: 'not-loaded' });
        return;
      }

      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        unsubscribe();
        preloadInterstitial();
        resolve(result);
      };

      const subs = [
        ad.addAdEventListener(AdEventType.CLOSED, () =>
          finish({ shown: true, simulated: false, reason: null })
        ),
        ad.addAdEventListener(AdEventType.ERROR, () =>
          finish({ shown: false, simulated: false, reason: 'error' })
        ),
      ];
      const unsubscribe = () => subs.forEach((off) => typeof off === 'function' && off());

      ad.show();
    } catch (e) {
      resolve({ shown: false, simulated: false, reason: 'error' });
    }
  });
}

export default {
  initialize,
  availability,
  canShow,
  preloadRewarded,
  showRewarded,
  preloadInterstitial,
  showInterstitial,
  UNAVAILABLE_REASON,
  SIMULATE_WHEN_UNAVAILABLE,
  SIMULATED_DURATION,
};

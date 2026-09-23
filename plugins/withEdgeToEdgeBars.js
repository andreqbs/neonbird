const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

/**
 * Tira do tema do app os parametros de barra descontinuados no Android 15.
 *
 * Do Android 15 em diante o app desenha de ponta a ponta (edge-to-edge): a tela
 * ocupa tudo, por baixo da barra de status e da barra de navegacao, e o sistema
 * ignora quem tenta pintar essas barras. `android:statusBarColor` e os outros
 * daqui sao justamente os parametros que cairam — e o Play Console avisa quem
 * ainda os declara. Quem os punha no tema era o proprio Expo (`withSystemBars`).
 *
 * Do Android 15 para cima nao muda nada na tela: o React Native ja deixa as duas
 * barras transparentes ao abrir, e a cor do tema nem seria olhada. Ate o Android
 * 14, porem, ninguem liga o ponta a ponta, e sem a cor a barra de status voltaria
 * ao preto do tema padrao — por isso `colorPrimaryDark` entra no lugar, com o
 * mesmo azul do fundo do jogo. Ele nao e um parametro descontinuado; e o
 * AppCompat que, nos Androids antigos, pinta a barra com ele.
 *
 * Vale a partir do proximo build (prebuild): o tema e gerado dele.
 */

// Os parametros descontinuados no Android 15 (API 35). Os que este projeto nao
// usa estao na lista de proposito: se algum outro plugin puser um deles no tema,
// ele sai junto.
const PARAMETROS_DESCONTINUADOS = [
  'android:statusBarColor',
  'android:navigationBarColor',
  'android:navigationBarDividerColor',
  'android:windowDrawsSystemBarBackgrounds',
  'android:windowTranslucentStatus',
  'android:windowTranslucentNavigation',
];

// O azul do fundo do jogo, que o Expo ja gera em colors.xml a partir do
// `backgroundColor` do app.json.
const COR_DA_BARRA = '@color/activityBackground';

/** Arruma o tema `AppTheme`. Separado do plugin para o teste alcancar. */
function ajustaTema(styles) {
  for (const name of PARAMETROS_DESCONTINUADOS) {
    styles = AndroidConfig.Styles.assignStylesValue(styles, {
      add: false,
      name,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
    });
  }
  return AndroidConfig.Styles.assignStylesValue(styles, {
    add: true,
    name: 'colorPrimaryDark',
    value: COR_DA_BARRA,
    parent: AndroidConfig.Styles.getAppThemeGroup(),
  });
}

module.exports = function withEdgeToEdgeBars(config) {
  return withAndroidStyles(config, (mod) => {
    mod.modResults = ajustaTema(mod.modResults);
    return mod;
  });
};

module.exports.ajustaTema = ajustaTema;
module.exports.PARAMETROS_DESCONTINUADOS = PARAMETROS_DESCONTINUADOS;
module.exports.COR_DA_BARRA = COR_DA_BARRA;

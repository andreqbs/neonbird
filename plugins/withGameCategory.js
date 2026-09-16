const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Declara o app como JOGO no Android (`android:appCategory="game"`).
 *
 * Do Android 16 em diante, em tela grande (tablet, dobravel aberto) o sistema
 * ignora a trava de orientacao dos apps comuns e deixa girar para paisagem —
 * e em paisagem o Major Flyer fica bem mais facil, o que desequilibra o ranking.
 * Jogos ficam de fora dessa regra, e e por essa categoria que o Android sabe.
 *
 * Vale a partir do proximo build (prebuild): o manifesto e gerado dele.
 */
module.exports = function withGameCategory(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$['android:appCategory'] = 'game';
    return mod;
  });
};

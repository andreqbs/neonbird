/**
 * O SDK do AdMob, quando ele existe.
 *
 * O `require` mora sozinho neste arquivo por causa do bundler. O Metro resolve
 * dependencia de forma ESTATICA: um `require('react-native-google-mobile-ads')`
 * dentro de try/catch nao protege nada — ele tenta empacotar o modulo do mesmo
 * jeito, e na WEB isso derruba o bundle inteiro (o pacote e so nativo, e o
 * proprio arquivo de entrada dele nao resolve fora de Android/iOS).
 *
 * A saida e a extensao de plataforma: este arquivo vale para Android e iOS, e o
 * `adsSdk.web.js` ao lado devolve null. Quem importa nao precisa saber disso.
 */
export default function loadSdk() {
  try {
    // eslint-disable-next-line global-require
    return require('react-native-google-mobile-ads');
  } catch (e) {
    // Biblioteca nao instalada ou Expo Go: o jogo segue na propaganda simulada.
    return null;
  }
}

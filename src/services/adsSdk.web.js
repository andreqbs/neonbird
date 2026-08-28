/**
 * Na web nao existe AdMob — e o pacote nativo nem chega a ser resolvido pelo
 * bundler por causa deste arquivo (ver `adsSdk.js`). O jogo cai na propaganda
 * simulada, que e exatamente o que se quer enquanto se testa no navegador.
 */
export default function loadSdk() {
  return null;
}

import React, { Fragment, useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';

import GameScreen from './src/screens/GameScreen';
import HomeScreen from './src/screens/HomeScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import LoadingScreen from './src/screens/LoadingScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ShopScreen from './src/screens/ShopScreen';
import usePlayer from './src/hooks/usePlayer';
import billing from './src/services/billing';
import economy from './src/services/economy';
import { forgetLocalRuns } from './src/services/scores';
import integrity from './src/services/integrity';
import audio from './src/audio/AudioManager';
import ads from './src/services/ads';
import { getLanguage, resolveLanguage, setLanguage } from './src/i18n';
import useLanguage from './src/i18n/useLanguage';
import { SettingsProvider, useSettings } from './src/state/SettingsContext';
import { theme } from './src/ui/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <Root />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { settings, loaded } = useSettings();
  const [screen, setScreen] = useState('home');
  // A partida que a tela de jogo abre: a do servidor (`run`) ou um treino.
  const [game, setGame] = useState(null);
  const lang = useLanguage();

  // A abertura: a tela de carregamento fica na frente ate a Home estar pronta
  // de verdade — preferencias, jogador, carteira do servidor e a propria Home
  // medida (ver LoadingScreen). A Home monta por tras desde o primeiro instante.
  const [booting, setBooting] = useState(true);
  const endBoot = useCallback(() => setBooting(false), []);
  // O idioma da Home que ja se mediu: trocar de idioma monta a Home de novo
  // (a chave do Fragment abaixo), e ai e a nova que precisa se medir.
  const [homeMedida, setHomeMedida] = useState(null);
  const marcaHome = useCallback(() => setHomeMedida(getLanguage()), []);

  // O idioma: o escolhido em Configuracoes ou, no automatico, o do celular (se
  // for um dos do jogo; senao, ingles). Antes de as preferencias chegarem do
  // disco, ja vale o do celular — e a troca, quando vem, redesenha as telas.
  useEffect(() => {
    if (loaded) setLanguage(resolveLanguage(settings.language));
  }, [loaded, settings.language]);
  // Cria o jogador (codigo + apelido) ja na abertura: sem ele nao ha partida no
  // servidor, nem video premiado que pague a alguem.
  usePlayer();

  // So retrato. Em paisagem as colunas ficam bem mais espacadas e o jogo fica
  // mais facil — injusto no ranking. O app.json ja abre travado; esta chamada
  // vale na hora, inclusive no build de desenvolvimento ja instalado (a trava do
  // app.json so chega ao Android com build nova).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Prepara a prova de integridade das partidas (Play Integrity): a primeira
  // preparacao com o Google leva alguns segundos, e no fim da partida o token
  // precisa sair na hora. Sem modulo nativo ou sem projeto, nao faz nada.
  useEffect(() => {
    integrity.prepare();
  }, []);

  // Compra com dinheiro que ficou pelo caminho (app fechado no meio do
  // pagamento, pagamento pendente que aprovou, app reinstalado): assim que a
  // carteira chega, as compras que o Google guarda sobem para o servidor.
  useEffect(() => {
    let feito = false;
    const confere = (estado) => {
      if (feito || estado.status !== 'ready') return;
      feito = true;
      billing.syncPurchases().catch(() => {});
    };
    confere(economy.economyNow());
    return economy.subscribeEconomy(confere);
  }, []);

  // O historico de partidas que as versoes antigas guardavam no aparelho: o
  // recorde e "Seus voos" agora vem do servidor, entao o que sobrou sai.
  useEffect(() => {
    forgetLocalRuns();
  }, []);

  // Liga o AdMob. O primeiro video premiado so carrega quando o jogador existe
  // (ver ads.setRewardUser). Sem SDK ou sem IDs isso nao faz nada.
  useEffect(() => {
    ads.initialize().catch(() => {});
  }, []);

  // So liga o audio depois que as preferencias salvas chegaram do disco: comecar
  // a tocar para pausar meio segundo depois faz o player cancelar o proprio play.
  useEffect(() => {
    if (!loaded) return undefined;
    audio.configure(settings);
    audio.setMusicWanted(true);
    audio.init();
    return () => audio.setMusicWanted(false);
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    audio.configure(settings);
  }, [settings, loaded]);

  // Silencia enquanto o app estiver em segundo plano.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      audio.setSuspended(state !== 'active');
    });
    return () => sub.remove();
  }, []);

  const goHome = useCallback(() => setScreen('home'), []);

  /**
   * Comecar uma partida e pedir ao servidor: e ele que desconta a vida e sorteia
   * as moedas. Devolve a resposta para a Home mostrar o motivo quando nao deu.
   */
  const startGame = useCallback(async () => {
    const r = await economy.startRun();
    if (r.ok) {
      setGame({ key: r.run.id, run: r.run, training: false });
      setScreen('game');
    }
    return r;
  }, []);

  /** Sem servidor: voa igual, sem moedas, vidas, loja nem ranking. */
  const startTraining = useCallback(() => {
    setGame({ key: `treino-${Date.now()}`, run: null, training: true });
    setScreen('game');
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={screen === 'game'} />

      {/* Enquanto a abertura cobre as telas, o leitor de tela tambem nao as le. */}
      <View style={styles.screens} aria-hidden={booting}>
        {/* A chave do idioma: trocar de idioma monta as telas de novo, ja com os
            textos novos. A tela aberta continua a mesma (ela mora fora daqui). */}
        <Fragment key={lang}>
          {screen === 'home' && (
            <HomeScreen onNavigate={setScreen} onPlay={startGame} onTrain={startTraining} onReady={marcaHome} />
          )}

          {screen === 'game' && game && (
            <GameScreen
              key={game.key}
              initialRun={game.run}
              training={game.training}
              onExit={goHome}
            />
          )}

          {screen === 'shop' && <ShopScreen onBack={goHome} />}

          {screen === 'leaderboard' && (
            <LeaderboardScreen onBack={goHome} onOpenSettings={() => setScreen('settings')} />
          )}

          {screen === 'settings' && (
            <SettingsScreen onBack={goHome} />
          )}
        </Fragment>
      </View>

      {booting && (
        <LoadingScreen settingsLoaded={loaded} homeReady={homeMedida === lang} onDone={endBoot} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.skyTop },
  screens: { flex: 1 },
});

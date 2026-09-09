import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';

import GameScreen from './src/screens/GameScreen';
import HomeScreen from './src/screens/HomeScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import useScores from './src/hooks/useScores';
import usePlayer from './src/hooks/usePlayer';
import cloud from './src/services/cloud';
import { spendLife } from './src/services/lives';
import audio from './src/audio/AudioManager';
import ads from './src/services/ads';
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
  const { best, refresh, submit } = useScores();
  // Cria o jogador (codigo + apelido) ja na abertura: sem isso, o primeiro
  // placar da instalacao nao teria a quem pertencer no ranking.
  usePlayer();

  // A tela acompanha o aparelho: nada de travar orientacao. O layout inteiro do
  // jogo e derivado do tamanho, entao girar so recalcula as medidas.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  // Liga o AdMob e ja deixa o primeiro video premiado carregando. Sem SDK ou
  // sem IDs cadastrados isso nao faz nada — e o jogo segue igual.
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

  const handleScore = useCallback(
    (score, meta) => {
      // Sobe para a rodada da semana sem segurar a tela: quando nao ha rede (ou
      // servidor configurado), `submitRun` guarda a partida e tenta de novo
      // depois. O historico local, que e o que aparece na hora, e o `submit`.
      cloud.submitRun(score);
      return submit(score, meta);
    },
    [submit]
  );

  const goHome = useCallback(() => setScreen('home'), []);

  /**
   * Comecar uma partida custa uma vida.
   *
   * O desconto fica aqui e na tela do jogo (o "jogar de novo"), que sao os dois
   * unicos jeitos de uma partida comecar. Girar o aparelho no meio do voo
   * remonta a tela, mas nao passa por nenhum dos dois — e nao cobra de novo.
   */
  const startGame = useCallback(() => {
    spendLife();
    setScreen('game');
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={screen === 'game'} />

      {/* Vidas nao viajam por props: cada tela le o servico direto. Numero que
          atravessa tres componentes chega tarde justamente quando importa — no
          Android, com o jogo ocupando a thread de JS. */}
      {screen === 'home' && <HomeScreen onNavigate={setScreen} onPlay={startGame} best={best} />}

      {screen === 'game' && (
        <GameScreen onExit={goHome} best={best} onScore={handleScore} />
      )}

      {screen === 'leaderboard' && (
        <LeaderboardScreen onBack={goHome} onOpenSettings={() => setScreen('settings')} />
      )}

      {screen === 'settings' && (
        <SettingsScreen onBack={goHome} onScoresCleared={refresh} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.skyTop },
});

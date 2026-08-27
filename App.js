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
import audio from './src/audio/AudioManager';
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

  // A tela acompanha o aparelho: nada de travar orientacao. O layout inteiro do
  // jogo e derivado do tamanho, entao girar so recalcula as medidas.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
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
    (score, meta) => submit(score, meta),
    [submit]
  );

  const goHome = useCallback(() => setScreen('home'), []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden={screen === 'game'} />

      {screen === 'home' && <HomeScreen onNavigate={setScreen} best={best} />}

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

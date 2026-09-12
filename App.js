import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';

import GameScreen from './src/screens/GameScreen';
import HomeScreen from './src/screens/HomeScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ShopScreen from './src/screens/ShopScreen';
import useScores from './src/hooks/useScores';
import usePlayer from './src/hooks/usePlayer';
import economy from './src/services/economy';
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
  // A partida que a tela de jogo abre: a do servidor (`run`) ou um treino.
  const [game, setGame] = useState(null);
  const { best, refresh, submit } = useScores();
  // Cria o jogador (codigo + apelido) ja na abertura: sem ele nao ha partida no
  // servidor, nem video premiado que pague a alguem.
  usePlayer();

  // A tela acompanha o aparelho: nada de travar orientacao. O layout inteiro do
  // jogo e derivado do tamanho, entao girar so recalcula as medidas.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
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

  // Recorde e historico continuam no aparelho: nao sao moeda de troca. Moedas e
  // ranking entram pelo fechamento da partida no servidor (GameScreen).
  const handleScore = useCallback((score, meta) => submit(score, meta), [submit]);

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

      {screen === 'home' && (
        <HomeScreen onNavigate={setScreen} onPlay={startGame} onTrain={startTraining} best={best} />
      )}

      {screen === 'game' && game && (
        <GameScreen
          key={game.key}
          initialRun={game.run}
          training={game.training}
          onExit={goHome}
          best={best}
          onScore={handleScore}
        />
      )}

      {screen === 'shop' && <ShopScreen onBack={goHome} />}

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

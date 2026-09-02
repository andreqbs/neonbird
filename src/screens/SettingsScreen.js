import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import Screen, { Card, SectionTitle } from '../ui/Screen';
import { ActionRow, ToggleRow } from '../ui/Row';
import { theme } from '../ui/theme';
import { useSettings } from '../state/SettingsContext';
import { clearRuns } from '../services/scores';
import { UNAVAILABLE_REASON, availability, getPlayer, signIn } from '../services/playGames';

const REASON_LABEL = {
  [UNAVAILABLE_REASON.PLATFORM]: 'Indisponivel (so Android)',
  [UNAVAILABLE_REASON.NO_NATIVE_MODULE]: 'Indisponivel nesta build',
  [UNAVAILABLE_REASON.NO_LEADERBOARD_ID]: 'Placar nao cadastrado',
};

const REASON_HELP = {
  [UNAVAILABLE_REASON.PLATFORM]:
    'O Google Play Jogos e um servico Android. Seus recordes continuam salvos no aparelho.',
  [UNAVAILABLE_REASON.NO_NATIVE_MODULE]:
    'A conta do Play Jogos exige codigo nativo, que o Expo Go nao carrega. Gere uma ' +
    'build com EAS Build para habilitar (veja o README).',
  [UNAVAILABLE_REASON.NO_LEADERBOARD_ID]:
    'Falta colar o ID do placar criado no Google Play Console em src/services/playGames.js.',
};

export default function SettingsScreen({ onBack, onScoresCleared }) {
  const { settings, setSetting } = useSettings();
  const [player, setPlayer] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const status = availability();

  useEffect(() => {
    if (!status.available) return;
    getPlayer().then(setPlayer).catch(() => {});
  }, [status.available]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    const result = await signIn();
    setPlayer(result);
    setConnecting(false);
    if (!result.signedIn) {
      Alert.alert('Nao foi possivel conectar', 'Tente de novo mais tarde ou confira sua conta do Google Play Jogos.');
    }
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert(
      'Apagar recordes locais?',
      'O historico de partidas guardado neste aparelho sera perdido. Nao da para desfazer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            await clearRuns();
            onScoresCleared?.();
          },
        },
      ]
    );
  }, [onScoresCleared]);

  const accountValue = status.available
    ? player?.signedIn
      ? player.playerName || 'Conectado'
      : 'Nao conectado'
    : REASON_LABEL[status.reason];

  return (
    <Screen title="Configurações" onBack={onBack}>
      <SectionTitle>Som</SectionTitle>
      <Card>
        <ToggleRow
          label="Música de fundo"
          description="Trilha musical durante a partida"
          value={settings.music}
          onValueChange={(v) => setSetting('music', v)}
        />
        <ToggleRow
          label="Som do toque"
          description="O bater de asas a cada toque na tela"
          value={settings.flapSound}
          onValueChange={(v) => setSetting('flapSound', v)}
        />
        <ToggleRow
          label="Efeitos do jogo"
          description="Ponto marcado e colisão"
          value={settings.effects}
          onValueChange={(v) => setSetting('effects', v)}
          last
        />
      </Card>

      {/*<SectionTitle>Conta</SectionTitle>*/}
      {/*<Card>*/}
      {/*  <ActionRow*/}
      {/*    label="Google Play Jogos"*/}
      {/*    description={*/}
      {/*      status.available*/}
      {/*        ? player?.signedIn*/}
      {/*          ? 'Seus placares sobem para o ranking global automaticamente.'*/}
      {/*          : 'Conecte para aparecer no ranking global.'*/}
      {/*        : REASON_HELP[status.reason]*/}
      {/*    }*/}
      {/*    value={connecting ? 'Conectando...' : accountValue}*/}
      {/*    onPress={status.available && !player?.signedIn ? handleConnect : undefined}*/}
      {/*    disabled={!status.available || connecting}*/}
      {/*    last*/}
      {/*  />*/}
      {/*</Card>*/}
      {/*{status.available && !player?.signedIn ? (*/}
      {/*  <Text style={styles.note}>*/}
      {/*    O Play Jogos costuma entrar sozinho ao abrir o jogo. Este botao serve para quando o*/}
      {/*    login automatico foi recusado ou voce quer trocar de conta.*/}
      {/*  </Text>*/}
      {/*) : null}*/}

      <SectionTitle>Dados</SectionTitle>
      <Card>
        <ActionRow
          label="Apagar recordes locais"
          description="Limpa o histórico de partidas neste aparelho."
          onPress={handleClear}
          danger
          last
        />
      </Card>

      <View style={styles.about}>
        <Text style={styles.aboutText}>Major Flyer</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginHorizontal: 6,
  },
  about: { marginTop: 32, alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  aboutText: { color: theme.text, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  aboutDim: { color: theme.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16 },
});

import React, { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import Screen, { Card, SectionTitle } from '../ui/Screen';
import { ActionRow, InputRow, ToggleRow } from '../ui/Row';
import { theme } from '../ui/theme';
import { useSettings } from '../state/SettingsContext';
import usePlayer from '../hooks/usePlayer';
import { NAME_MAX } from '../services/identity';
import { clearRuns } from '../services/scores';

export default function SettingsScreen({ onBack, onScoresCleared }) {
  const { settings, setSetting } = useSettings();
  const { player, rename } = usePlayer();
  const [enviado, setEnviado] = useState(false);


  /**
   * Passar o codigo adiante. O `Share` do sistema resolve os dois casos de uma
   * vez — mandar direto no WhatsApp do amigo ou so copiar — e nao custa
   * biblioteca nova nenhuma ao app.
   */
  const compartilharCodigo = useCallback(async () => {
    if (!player) return;
    try {
      await Share.share({
        message:
          'Me chama para o seu grupo no Major Flyer! Meu codigo de jogador e:\n\n' + player.id,
      });
      setEnviado(true);
      setTimeout(() => setEnviado(false), 2000);
    } catch (e) {
      // o jogador fechou a folha de compartilhamento: nao ha o que fazer
    }
  }, [player]);
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

      <SectionTitle>Jogador</SectionTitle>
      <Card>
        <InputRow
          label="Seu nome"
          description="É assim que você aparece no ranking e no grupo."
          value={player?.name ?? ''}
          maxLength={NAME_MAX}
          placeholder="Seu apelido"
          onSubmit={rename}
        />
        <View style={styles.codeRow}>
          <View style={styles.codeTexts}>
            <Text style={styles.codeLabel}>Seu código de jogador</Text>
            <Text style={styles.codeHint}>
              Mande para quem vai te chamar para um grupo. Só o líder consegue adicionar alguém, e
              ele precisa deste código.
            </Text>
            <Text style={styles.code} selectable numberOfLines={2}>
              {player?.id ?? '...'}
            </Text>
          </View>
          <Pressable
            onPress={compartilharCodigo}
            disabled={!player}
            style={({ pressed }) => [styles.codeButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.codeButtonLabel}>{enviado ? 'Enviado' : 'Compartilhar'}</Text>
          </Pressable>
        </View>
      </Card>

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
  codeRow: { paddingHorizontal: 18, paddingVertical: 15, gap: 12 },
  codeTexts: { gap: 4 },
  codeLabel: { color: theme.text, fontSize: 15, fontWeight: '700' },
  codeHint: { color: theme.textDim, fontSize: 12, lineHeight: 17 },
  code: {
    marginTop: 6,
    color: theme.pillar,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  codeButton: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(46,230,197,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.45)',
  },
  codeButtonLabel: { color: theme.pillar, fontSize: 14, fontWeight: '800' },

  about: { marginTop: 32, alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  aboutText: { color: theme.text, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  aboutDim: { color: theme.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16 },
});

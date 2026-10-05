import React, { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import Screen, { Card, SectionTitle } from '../ui/Screen';
import { ActionRow, ChoiceRow, InputRow, ToggleRow } from '../ui/Row';
import { theme } from '../ui/theme';
import { useSettings } from '../state/SettingsContext';
import usePlayer from '../hooks/usePlayer';
import { AUTO, LANGUAGES, detectDeviceLanguage, languageName, t } from '../i18n';
import { NAME_MAX } from '../services/identity';
import { clearRuns } from '../services/scores';

export default function SettingsScreen({ onBack, onScoresCleared }) {
  const { settings, setSetting } = useSettings();
  const { player, rename } = usePlayer();
  const [enviado, setEnviado] = useState(false);
  const [idiomas, setIdiomas] = useState(false);

  /**
   * Passar o codigo adiante. O `Share` do sistema resolve os dois casos de uma
   * vez — mandar direto no WhatsApp do amigo ou so copiar — e nao custa
   * biblioteca nova nenhuma ao app.
   */
  const compartilharCodigo = useCallback(async () => {
    if (!player) return;
    try {
      await Share.share({ message: t('settings.shareMessage', { code: player.id }) });
      setEnviado(true);
      setTimeout(() => setEnviado(false), 2000);
    } catch (e) {
      // o jogador fechou a folha de compartilhamento: nao ha o que fazer
    }
  }, [player]);
  const handleClear = useCallback(() => {
    Alert.alert(t('settings.clearConfirmTitle'), t('settings.clearConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.clear'),
        style: 'destructive',
        onPress: async () => {
          await clearRuns();
          onScoresCleared?.();
        },
      },
    ]);
  }, [onScoresCleared]);

  // O idioma. Escolher um faz o app redesenhar as telas ja no idioma novo (a
  // raiz assina a troca) — e esta lista fecha sozinha nessa hora.
  const escolhido = settings.language || AUTO;
  const doCelular = languageName(detectDeviceLanguage());

  return (
    <Screen title={t('settings.title')} onBack={onBack}>
      <SectionTitle>{`🌐 ${t('settings.language')}`}</SectionTitle>
      <Card>
        <ActionRow
          label={escolhido === AUTO ? t('settings.languageAuto') : languageName(escolhido)}
          description={escolhido === AUTO ? t('settings.languageAutoDesc', { name: doCelular }) : undefined}
          onPress={() => setIdiomas((aberto) => !aberto)}
          last={!idiomas}
        />
        {idiomas ? (
          <>
            <ChoiceRow
              label={t('settings.languageAuto')}
              description={t('settings.languageAutoDesc', { name: doCelular })}
              selected={escolhido === AUTO}
              onPress={() => setSetting('language', AUTO)}
            />
            {LANGUAGES.map((l, i) => (
              <ChoiceRow
                key={l.code}
                label={l.name}
                selected={escolhido === l.code}
                onPress={() => setSetting('language', l.code)}
                last={i === LANGUAGES.length - 1}
              />
            ))}
          </>
        ) : null}
      </Card>

      <SectionTitle>{t('settings.sound')}</SectionTitle>
      <Card>
        <ToggleRow
          label={t('settings.music')}
          description={t('settings.musicDesc')}
          value={settings.music}
          onValueChange={(v) => setSetting('music', v)}
        />
        <ToggleRow
          label={t('settings.flap')}
          description={t('settings.flapDesc')}
          value={settings.flapSound}
          onValueChange={(v) => setSetting('flapSound', v)}
        />
        <ToggleRow
          label={t('settings.effects')}
          description={t('settings.effectsDesc')}
          value={settings.effects}
          onValueChange={(v) => setSetting('effects', v)}
          last
        />
      </Card>

      <SectionTitle>{t('settings.player')}</SectionTitle>
      <Card>
        <InputRow
          label={t('settings.yourName')}
          description={t('settings.yourNameDesc')}
          value={player?.name ?? ''}
          maxLength={NAME_MAX}
          placeholder={t('settings.namePlaceholder')}
          onSubmit={rename}
        />
        <View style={styles.codeRow}>
          <View style={styles.codeTexts}>
            <Text style={styles.codeLabel}>{t('settings.yourCode')}</Text>
            <Text style={styles.codeHint}>{t('settings.codeHint')}</Text>
            <Text style={styles.code} selectable numberOfLines={2}>
              {player?.id ?? '...'}
            </Text>
          </View>
          <Pressable
            onPress={compartilharCodigo}
            disabled={!player}
            style={({ pressed }) => [styles.codeButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.codeButtonLabel}>{enviado ? t('settings.shared') : t('settings.share')}</Text>
          </Pressable>
        </View>
      </Card>

      <SectionTitle>{t('settings.data')}</SectionTitle>
      <Card>
        <ActionRow
          label={t('settings.clearRecords')}
          description={t('settings.clearRecordsDesc')}
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

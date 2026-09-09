import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { theme } from './theme';

/** Linha de configuracao com interruptor. */
export function ToggleRow({ label, description, value, onValueChange, disabled, last }) {
  return (
    <View style={[styles.row, last && styles.last, disabled && styles.disabled]}>
      <View style={styles.texts}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: 'rgba(46,230,197,0.55)' }}
        thumbColor={value ? theme.pillar : '#C8CEE6'}
        ios_backgroundColor="rgba(255,255,255,0.18)"
      />
    </View>
  );
}

/** Linha clicavel, com um valor ou acao a direita. */
export function ActionRow({ label, description, value, onPress, danger, last, disabled }) {
  const body = (
    <View style={[styles.row, last && styles.last, disabled && styles.disabled]}>
      <View style={styles.texts}>
        <Text style={[styles.label, danger && { color: theme.danger }]}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {onPress && !disabled ? <Text style={styles.chevron}>›</Text> : null}
    </View>
  );

  if (!onPress || disabled) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.65 }}>
      {body}
    </Pressable>
  );
}

/**
 * Linha com campo de texto e um botao de salvar que so aparece quando ha o que
 * salvar.
 *
 * O botao e explicito de proposito. Salvar "ao sair do campo" parece elegante e
 * falha justamente no celular: o teclado fecha, o dedo vai para outra tela, e o
 * jogador nunca sabe se o que ele digitou valeu. Com o botao ele ve o "Salvo".
 * O Enter do teclado tambem salva, para quem prefere.
 */
export function InputRow({ label, description, value, onSubmit, placeholder, maxLength, last }) {
  const [texto, setTexto] = useState(value ?? '');
  const [salvo, setSalvo] = useState(false);
  useEffect(() => setTexto(value ?? ''), [value]);

  const mudou = (texto || '').trim() !== (value ?? '').trim();

  const enviar = () => {
    if (!mudou) return;
    const aceito = onSubmit?.(texto);
    if (typeof aceito === 'string') {
      setTexto(aceito);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 1600);
    } else if (aceito === null || aceito === false) {
      // Recusado (curto demais, so espacos): volta ao que valia antes.
      setTexto(value ?? '');
    }
  };

  return (
    <View style={[styles.inputRow, last && styles.last]}>
      <View style={styles.texts}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>

      <View style={styles.inputLine}>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          onSubmitEditing={enviar}
          placeholder={placeholder}
          placeholderTextColor="rgba(150,161,206,0.6)"
          maxLength={maxLength}
          returnKeyType="done"
          style={styles.input}
        />
        {mudou ? (
          <Pressable onPress={enviar} style={({ pressed }) => [styles.save, pressed && { opacity: 0.7 }]}>
            <Text style={styles.saveLabel}>Salvar</Text>
          </Pressable>
        ) : salvo ? (
          <Text style={styles.saved}>Salvo</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    gap: 12,
  },
  last: { borderBottomWidth: 0 },
  disabled: { opacity: 0.45 },
  texts: { flex: 1 },
  label: { color: theme.text, fontSize: 15, fontWeight: '700' },
  description: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 3 },
  value: { color: theme.textDim, fontSize: 14, fontWeight: '600' },
  chevron: { color: theme.textDim, fontSize: 22, marginLeft: 2, marginTop: -2 },
  inputRow: {
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    gap: 10,
  },
  inputLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  save: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(46,230,197,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.5)',
  },
  saveLabel: { color: theme.pillar, fontSize: 13, fontWeight: '800' },
  saved: { color: theme.pillar, fontSize: 13, fontWeight: '700' },
});

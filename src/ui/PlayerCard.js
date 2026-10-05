import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { skinLook } from '../game/skins';
import { t } from '../i18n';
import { birdName, skinName, slotName } from '../i18n/catalog';
import useEconomy from '../hooks/useEconomy';
import BirdAvatar from './BirdAvatar';
import Button from './Button';
import { theme } from './theme';

/**
 * O cartao de um jogador, aberto ao tocar no nome dele no ranking: o passaro
 * que ele usa, vestido com as skins dele, e a colecao inteira de skins.
 *
 * Tudo vem da linha do ranking (`look`, server/store.go) — so o que e visual,
 * nada de moeda nem de compra. Os nomes vem do catalogo da loja; sem ele, o
 * cartao mostra so o passaro.
 *
 * `player` e a linha do ranking ({ name, total, best, look }); null fecha.
 */
export default function PlayerCard({ player, onClose }) {
  return (
    <Modal visible={Boolean(player)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')}>
        {player ? <CardBody player={player} onClose={onClose} /> : null}
      </Pressable>
    </Modal>
  );
}

const SEM_NADA = { bird: 'classic', skins: {}, ownedSkins: [] };

function CardBody({ player, onClose }) {
  const { catalog } = useEconomy();
  const look = { ...SEM_NADA, ...(player.look || {}) };
  const birds = (catalog && catalog.birds) || [];
  const encaixes = (catalog && catalog.skinSlots) || [];
  // So as skins que este app sabe desenhar — as mesmas que a loja mostra.
  const skins = ((catalog && catalog.skins) || []).filter((s) => skinLook(s.id));

  const bird = birds.find((b) => b.id === look.bird);
  const donas = new Set(look.ownedSkins || []);
  const colecao = skins.filter((s) => donas.has(s.id));
  const vestida = (s) => look.skins && look.skins[s.slot] === s.id;

  return (
    // Toque dentro do cartao nao fecha: so o fundo escuro fecha.
    <Pressable style={styles.card} onPress={() => {}}>
      <View style={styles.head}>
        <BirdAvatar birdId={look.bird} skins={look.skins} size={64} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {player.name}
          </Text>
          {bird ? <Text style={styles.meta}>{t('playerCard.flies', { bird: birdName(bird) })}</Text> : null}
          {typeof player.total === 'number' ? (
            <Text style={styles.meta}>
              {t('playerCard.seasonPoints', { points: t('common.points', { count: player.total }) })}
              {typeof player.best === 'number' ? t('playerCard.best', { n: player.best }) : ''}
            </Text>
          ) : null}
        </View>
      </View>

      {catalog ? (
        <>
          <Text style={styles.section}>
            {t('playerCard.collection', { have: colecao.length, total: skins.length })}
          </Text>
          {colecao.length === 0 ? (
            <Text style={styles.empty}>{t('playerCard.noSkins')}</Text>
          ) : (
            encaixes.map((encaixe) => {
              const doEncaixe = colecao.filter((s) => s.slot === encaixe.id);
              if (doEncaixe.length === 0) return null;
              return (
                <View key={encaixe.id} style={styles.slot}>
                  <Text style={styles.slotName}>{slotName(encaixe)}</Text>
                  <View style={styles.chips}>
                    {doEncaixe.map((s) => (
                      <View key={s.id} style={[styles.chip, vestida(s) && styles.chipOn]}>
                        <Text style={[styles.chipText, vestida(s) && styles.chipTextOn]}>
                          {vestida(s) ? `● ${skinName(s)}` : skinName(s)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })
          )}
          {colecao.some(vestida) ? <Text style={styles.hint}>{t('playerCard.inUseNow')}</Text> : null}
        </>
      ) : null}

      <Button title={t('common.close')} variant="ghost" compact onPress={onClose} style={styles.close} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(4,6,18,0.78)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#11173A',
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.35)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: theme.text, fontSize: 19, fontWeight: '900' },
  meta: { color: theme.textDim, fontSize: 12, marginTop: 3 },

  section: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginTop: 18,
    marginBottom: 8,
  },
  empty: { color: theme.textDim, fontSize: 13 },
  slot: { marginBottom: 10 },
  slotName: { color: theme.text, fontSize: 12, fontWeight: '800', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  chipOn: { backgroundColor: 'rgba(46,230,197,0.16)', borderColor: 'rgba(46,230,197,0.6)' },
  chipText: { color: theme.textDim, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: theme.pillar },
  hint: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  close: { alignSelf: 'center', marginTop: 16 },
});

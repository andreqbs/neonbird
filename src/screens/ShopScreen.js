import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describePower } from '../game/powers';
import { CoinFace } from '../game/render/Coin';
import useAds from '../hooks/useAds';
import useEconomy from '../hooks/useEconomy';
import economy from '../services/economy';
import AdCover from '../ui/AdCover';
import BirdAvatar from '../ui/BirdAvatar';
import Button from '../ui/Button';
import Screen, { Card, SectionTitle } from '../ui/Screen';
import { theme } from '../ui/theme';

/** Quanto tempo o botao de compra fica esperando o segundo toque. */
const CONFIRM_MS = 3500;

/**
 * A loja: passaros, escudos e novas chances.
 *
 * Tudo o que aparece aqui veio do servidor — precos, o que o jogador tem, o que
 * esta em uso. Nenhum botao muda numero na tela por conta propria: a compra vai
 * ao servidor, e a tela so redesenha com a carteira que ele devolver.
 *
 * Compra em moedas pede DOIS toques: o primeiro arma o botao ("Confirmar"), o
 * segundo compra. Dedo esbarrando num passaro de 1.200 moedas nao pode virar
 * compra — e e mais honesto que um dialogo, que na web nem aparece.
 */
export default function ShopScreen({ onBack }) {
  const eco = useEconomy();
  const { adState, adSeconds, watchAdFor, canWatch } = useAds();
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null); // { error, text }
  const armTimer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    economy.refresh();
    return () => {
      mounted.current = false;
      clearTimeout(armTimer.current);
    };
  }, []);

  const arm = useCallback((id) => {
    setArmed(id);
    clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(null), CONFIRM_MS);
  }, []);

  /** Leva a acao ao servidor e mostra o que ele respondeu. */
  const act = useCallback(
    async (id, action, successText) => {
      if (busy) return;
      setBusy(id);
      setArmed(null);
      setMessage(null);
      const r = await action();
      if (!mounted.current) return;
      setBusy(null);
      if (r.ok) setMessage({ error: false, text: successText });
      else if (r.error) setMessage({ error: true, text: r.error });
    },
    [busy]
  );

  const purchase = useCallback(
    (id, price, action, successText) => {
      const coins = economy.economyNow().wallet?.coins ?? 0;
      if (price === null || price === undefined) return;
      if (coins < price) {
        setArmed(null);
        setMessage({ error: true, text: `Faltam ${price - coins} moedas.` });
        return;
      }
      if (armed !== id) {
        setMessage(null);
        arm(id);
        return;
      }
      act(id, action, successText);
    },
    [act, arm, armed]
  );

  const wallet = eco.wallet;
  const catalog = eco.catalog;

  if (eco.status === 'offline') {
    return (
      <Screen title="Loja" onBack={onBack}>
        <Card style={styles.notice}>
          <Text style={styles.noticeTitle}>A loja precisa de internet</Text>
          <Text style={styles.noticeBody}>
            Suas moedas, pássaros e itens ficam guardados no servidor — sem conexão, não dá para ver
            nem comprar nada. O modo treino continua funcionando.
          </Text>
          <Button
            title="Tentar de novo"
            variant="ghost"
            compact
            onPress={() => economy.refresh()}
            style={{ alignSelf: 'flex-start', marginTop: 8 }}
          />
        </Card>
      </Screen>
    );
  }

  if (!wallet || !catalog) {
    return (
      <Screen title="Loja" onBack={onBack}>
        <Card style={styles.center}>
          <ActivityIndicator color={theme.pillar} />
          <Text style={styles.dim}>Abrindo a loja...</Text>
        </Card>
      </Screen>
    );
  }

  const shieldPrice = catalog.items?.shield?.price ?? null;
  const continuePrice = catalog.items?.continue?.price ?? null;

  const footer = message ? (
    <Text style={message.error ? styles.error : styles.success}>{message.text}</Text>
  ) : null;

  return (
    <View style={styles.root}>
      <Screen title="Loja" onBack={onBack} footer={footer}>
        <WalletBar wallet={wallet} />

        <SectionTitle>Pássaros</SectionTitle>
        <Card>
          {catalog.birds.map((bird, i) => {
            const id = `bird:${bird.id}`;
            return (
              <BirdRow
                key={bird.id}
                bird={bird}
                owned={wallet.ownedBirds.includes(bird.id)}
                equipped={wallet.equippedBird === bird.id}
                coins={wallet.coins}
                armed={armed === id}
                busy={busy === id}
                last={i === catalog.birds.length - 1}
                onBuy={() =>
                  purchase(
                    id,
                    bird.price,
                    () => economy.buy('bird', bird.id),
                    `${bird.name} é seu! Toque em Usar para voar com ele.`
                  )
                }
                onEquip={() =>
                  act(id, () => economy.equip(bird.id), `${bird.name} voa na próxima partida.`)
                }
              />
            );
          })}
        </Card>

        <SectionTitle>Itens</SectionTitle>
        <Card>
          <ItemRow
            icon={<ShieldIcon size={30} />}
            title="Escudo"
            description="Perdoa as batidas enquanto se dissipa. Use no começo de uma fase."
            stock={wallet.shields}
            price={shieldPrice}
            coins={wallet.coins}
            armed={armed === 'shield'}
            busy={busy === 'shield' || busy === 'ad:shield'}
            canWatch={canWatch}
            onBuy={() => purchase('shield', shieldPrice, () => economy.buy('shield'), 'Escudo guardado.')}
            onWatch={() => act('ad:shield', () => watchAdFor('shield'), 'Escudo guardado.')}
          />
          <ItemRow
            icon={<ChanceIcon size={30} />}
            title="Nova chance"
            description="Ao cair, continue do mesmo ponto — uma vez por partida."
            stock={wallet.continues}
            price={continuePrice}
            coins={wallet.coins}
            armed={armed === 'continue'}
            busy={busy === 'continue' || busy === 'ad:continue'}
            canWatch={canWatch}
            last
            onBuy={() =>
              purchase('continue', continuePrice, () => economy.buy('continue'), 'Nova chance guardada.')
            }
            onWatch={() => act('ad:continue', () => watchAdFor('continue'), 'Nova chance guardada.')}
          />
        </Card>
      </Screen>

      <AdCover state={adState} seconds={adSeconds} />
    </View>
  );
}

// ------------------------------------------------------------------- pecas

function WalletBar({ wallet }) {
  return (
    <View style={styles.wallet}>
      <View style={styles.walletItem}>
        <CoinFace size={22} />
        <Text style={styles.walletValue}>{wallet.coins}</Text>
        <Text style={styles.walletLabel}>moedas</Text>
      </View>
      <View style={styles.walletDivider} />
      <View style={styles.walletItem}>
        <ShieldIcon size={20} />
        <Text style={styles.walletValue}>{wallet.shields}</Text>
        <Text style={styles.walletLabel}>escudos</Text>
      </View>
      <View style={styles.walletDivider} />
      <View style={styles.walletItem}>
        <ChanceIcon size={20} />
        <Text style={styles.walletValue}>{wallet.continues}</Text>
        <Text style={styles.walletLabel}>chances</Text>
      </View>
    </View>
  );
}

function BirdRow({ bird, owned, equipped, coins, armed, busy, last, onBuy, onEquip }) {
  let action;
  if (equipped) {
    action = <Text style={styles.inUse}>EM USO</Text>;
  } else if (owned) {
    action = busy ? (
      <ActivityIndicator color={theme.pillar} />
    ) : (
      <Button title="Usar" variant="ghost" compact onPress={onEquip} />
    );
  } else {
    action = (
      <PriceButton
        price={bird.price}
        armed={armed}
        busy={busy}
        short={coins < bird.price}
        onPress={onBuy}
      />
    );
  }

  return (
    <View style={[styles.row, last && styles.last, equipped && styles.rowActive]}>
      <BirdAvatar birdId={bird.id} size={30} />
      <View style={styles.rowTexts}>
        <Text style={styles.rowTitle}>{bird.name}</Text>
        <Text style={styles.rowDesc}>{bird.tagline}</Text>
        {bird.powers && bird.powers.length > 0 ? (
          bird.powers.map((p) => (
            <Text key={p.id} style={styles.ability}>
              {describePower(p)}
            </Text>
          ))
        ) : (
          <Text style={[styles.ability, styles.noPower]}>Sem poder</Text>
        )}
      </View>
      {action}
    </View>
  );
}

function ItemRow({ icon, title, description, stock, price, coins, armed, busy, canWatch, last, onBuy, onWatch }) {
  return (
    <View style={[styles.item, last && styles.last]}>
      <View style={styles.itemHead}>
        {icon}
        <View style={styles.rowTexts}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowDesc}>{description}</Text>
        </View>
        <View style={styles.stock}>
          <Text style={styles.stockValue}>{stock}</Text>
          <Text style={styles.stockLabel}>guardados</Text>
        </View>
      </View>
      <View style={styles.itemActions}>
        {price !== null ? (
          <PriceButton price={price} armed={armed} busy={busy} short={coins < price} onPress={onBuy} />
        ) : null}
        {canWatch ? (
          <Button title="Assistir anúncio" variant="ghost" compact onPress={busy ? undefined : onWatch} />
        ) : null}
      </View>
    </View>
  );
}

/** Botao de preco. Primeiro toque arma, segundo compra; sem saldo, fica apagado. */
function PriceButton({ price, armed, busy, short, onPress }) {
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [
        styles.price,
        armed && styles.priceArmed,
        short && styles.priceShort,
        pressed && { opacity: 0.75 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.bird} />
      ) : armed ? (
        <Text style={styles.priceArmedText}>{`Confirmar ${price}`}</Text>
      ) : (
        <>
          <CoinFace size={14} />
          <Text style={styles.priceText}>{price}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Um anel frio, da cor do escudo do jogo. */
export function ShieldIcon({ size = 20 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.max(2, size * 0.14),
        borderColor: theme.shield,
        backgroundColor: 'rgba(143,247,255,0.12)',
      }}
    />
  );
}

/** Seta de "de novo" num circulo. */
export function ChanceIcon({ size = 20 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(46,230,197,0.16)',
        borderWidth: 1.5,
        borderColor: 'rgba(46,230,197,0.6)',
      }}
    >
      <Text style={{ color: theme.pillar, fontSize: size * 0.62, fontWeight: '900', marginTop: -size * 0.06 }}>
        ↺
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  notice: { padding: 20, gap: 10 },
  noticeTitle: { color: theme.text, fontSize: 16, fontWeight: '800' },
  noticeBody: { color: theme.textDim, fontSize: 13, lineHeight: 20 },
  center: { padding: 28, alignItems: 'center', gap: 10 },
  dim: { color: theme.textDim, fontSize: 13 },

  wallet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,213,74,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,213,74,0.3)',
    marginTop: 6,
  },
  walletItem: { alignItems: 'center', gap: 4, minWidth: 80 },
  walletValue: { color: theme.text, fontSize: 20, fontWeight: '900' },
  walletLabel: { color: theme.textDim, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  walletDivider: { width: 1, height: 42, backgroundColor: 'rgba(255,255,255,0.12)' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  rowActive: { backgroundColor: 'rgba(46,230,197,0.09)' },
  last: { borderBottomWidth: 0 },
  rowTexts: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 15, fontWeight: '800' },
  rowDesc: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 2 },
  ability: { color: 'rgba(46,230,197,0.85)', fontSize: 11, marginTop: 3, fontWeight: '700', lineHeight: 15 },
  noPower: { color: 'rgba(150,161,206,0.7)' },
  inUse: { color: theme.pillar, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  item: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stock: { alignItems: 'center', minWidth: 58 },
  stockValue: { color: theme.text, fontSize: 20, fontWeight: '900' },
  stockLabel: { color: theme.textDim, fontSize: 10, letterSpacing: 0.8 },

  price: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 84,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,213,74,0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,213,74,0.55)',
  },
  priceArmed: { backgroundColor: theme.bird, borderColor: '#FFF0B8' },
  priceShort: { opacity: 0.45 },
  priceText: { color: theme.bird, fontSize: 14, fontWeight: '900' },
  priceArmedText: { color: '#1A1330', fontSize: 13, fontWeight: '900' },

  error: { color: theme.danger, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  success: { color: theme.pillar, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});

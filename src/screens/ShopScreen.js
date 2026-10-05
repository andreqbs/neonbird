import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describePower } from '../game/powers';
import { CoinFace } from '../game/render/Coin';
import { skinLook } from '../game/skins';
import useAds from '../hooks/useAds';
import useEconomy from '../hooks/useEconomy';
import { formatSeconds, t } from '../i18n';
import { birdName, birdTagline, skinName, skinTagline, slotName } from '../i18n/catalog';
import billing from '../services/billing';
import economy from '../services/economy';
import AdCover from '../ui/AdCover';
import BirdAvatar from '../ui/BirdAvatar';
import Button from '../ui/Button';
import Screen, { Card, SectionTitle } from '../ui/Screen';
import Stars from '../ui/Stars';
import Tabs from '../ui/Tabs';
import { theme } from '../ui/theme';

/** Quanto tempo o botao de compra fica esperando o segundo toque. */
const CONFIRM_MS = 3500;

const tabs = () => [
  { id: 'birds', label: t('shop.tabBirds') },
  { id: 'skins', label: t('shop.tabSkins') },
];

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
 *
 * Compra com dinheiro (billing.js) e um toque so: quem pede a confirmacao e a
 * tela de pagamento do Google Play. O preco escrito ("R$ 4,99") vem de la.
 *
 * ESTRELAS: cada passaro com poder de tempo evolui ate cinco estrelas, compradas
 * com moedas — e cada uma estica o tempo do poder. A Brasa e o Cometa ja nascem
 * com as cinco: o poder deles nao e de tempo. Quem guarda o nivel e faz a conta
 * e o servidor; aqui so se mostram as estrelas e se manda o pedido.
 *
 * ABAS: "Birds" e a loja de sempre (passaros, escudo, nova chance); "Skins" sao
 * os enfeites — bone, asas, oculos e colar —, que valem em qualquer passaro e
 * aparecem para os outros jogadores no ranking. Cada skin da loja ja aparece
 * VESTIDA no passaro do jogador, junto com o que ele usa nos outros encaixes:
 * da para ver como fica antes de comprar.
 */
export default function ShopScreen({ onBack }) {
  const eco = useEconomy();
  const { adState, adSeconds, watchAdFor, canWatch } = useAds();
  const [tab, setTab] = useState('birds');
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null); // { error, text }
  const armTimer = useRef(null);
  const mounted = useRef(true);
  // Os precos em dinheiro chegam do Google Play depois: so redesenha.
  const [, setPrecos] = useState(0);

  useEffect(() => {
    economy.refresh();
    const sai = billing.subscribeBilling(() => {
      if (mounted.current) setPrecos((n) => n + 1);
    });
    return () => {
      mounted.current = false;
      clearTimeout(armTimer.current);
      sai();
    };
  }, []);

  const birds = eco.catalog && eco.catalog.birds;
  const skins = eco.catalog && eco.catalog.skins;
  useEffect(() => {
    if (birds || skins) billing.loadPrices([...(birds || []), ...(skins || [])]);
  }, [birds, skins]);

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
        setMessage({ error: true, text: t('shop.short', { count: price - coins }) });
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

  /**
   * Compra com dinheiro (passaro ou skin): o Google Play pede a confirmacao, o
   * servidor entrega.
   */
  const buyWithMoney = useCallback(
    async (item, successText) => {
      if (busy) return;
      setBusy(`money:${item.id}`);
      setArmed(null);
      setMessage(null);
      const r = await billing.buyItem(item);
      if (!mounted.current) return;
      setBusy(null);
      if (r.ok) setMessage({ error: false, text: successText });
      else if (r.pending) setMessage({ error: false, text: r.error });
      else if (!r.cancelled && r.error) setMessage({ error: true, text: r.error });
    },
    [busy]
  );

  const changeTab = useCallback((id) => {
    setTab(id);
    setArmed(null);
    setMessage(null);
  }, []);

  const wallet = eco.wallet;
  const catalog = eco.catalog;

  if (eco.status === 'offline') {
    return (
      <Screen title={t('shop.title')} onBack={onBack}>
        <Card style={styles.notice}>
          <Text style={styles.noticeTitle}>{t('shop.offlineTitle')}</Text>
          <Text style={styles.noticeBody}>{t('shop.offlineBody')}</Text>
          <Button
            title={t('common.retry')}
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
      <Screen title={t('shop.title')} onBack={onBack}>
        <Card style={styles.center}>
          <ActivityIndicator color={theme.pillar} />
          <Text style={styles.dim}>{t('shop.opening')}</Text>
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
      <Screen title={t('shop.title')} onBack={onBack} footer={footer}>
        <WalletBar wallet={wallet} />
        <Tabs tabs={tabs()} value={tab} onChange={changeTab} style={styles.tabs} />

        {tab === 'skins' ? (
          <SkinsTab
            catalog={catalog}
            wallet={wallet}
            armed={armed}
            busy={busy}
            onBuy={(skin) =>
              purchase(
                `skin:${skin.id}`,
                skin.price,
                () => economy.buy('skin', skin.id),
                t('shop.skinBought', { name: skinName(skin) })
              )
            }
            onBuyMoney={(skin) =>
              buyWithMoney(skin, t('shop.skinBought', { name: skinName(skin) }))
            }
            onEquip={(skin) =>
              act(
                `skin:${skin.id}`,
                () => economy.equipSkin(skin.id),
                t('shop.skinEquipped', { name: skinName(skin) })
              )
            }
            onUnequip={(skin) =>
              act(
                `skin:${skin.id}`,
                () => economy.unequipSkin(skin.slot),
                t('shop.skinRemoved', { name: skinName(skin) })
              )
            }
          />
        ) : (
          <>
            <SectionTitle>{t('shop.birdsSection')}</SectionTitle>
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
                    stars={
                      // Quem nao evolui (Brasa, Cometa) ja nasce com as cinco estrelas.
                      bird.upgradable
                        ? (wallet.birdLevels && wallet.birdLevels[bird.id]) || 0
                        : bird.maxStars || 0
                    }
                    upgradeArmed={armed === `estrela:${bird.id}`}
                    upgradeBusy={busy === `estrela:${bird.id}`}
                    onUpgrade={(preco) =>
                      purchase(
                        `estrela:${bird.id}`,
                        preco,
                        () => economy.upgradeBird(bird.id),
                        t('shop.starGained', { name: birdName(bird) })
                      )
                    }
                    moneyPrice={billing.priceOf(bird.productId)}
                    moneyReady={billing.isAvailable()}
                    moneyBusy={busy === `money:${bird.id}`}
                    onBuyMoney={() =>
                      buyWithMoney(bird, t('shop.birdBought', { name: birdName(bird) }))
                    }
                    last={i === catalog.birds.length - 1}
                    onBuy={() =>
                      purchase(
                        id,
                        bird.price,
                        () => economy.buy('bird', bird.id),
                        t('shop.birdBought', { name: birdName(bird) })
                      )
                    }
                    onEquip={() =>
                      act(id, () => economy.equip(bird.id), t('shop.birdEquipped', { name: birdName(bird) }))
                    }
                  />
                );
              })}
            </Card>

            <SectionTitle>{t('shop.itemsSection')}</SectionTitle>
            <Card>
              <ItemRow
                icon={<ShieldIcon size={30} />}
                title={t('shop.shieldTitle')}
                description={t('shop.shieldDesc')}
                stock={wallet.shields}
                price={shieldPrice}
                coins={wallet.coins}
                armed={armed === 'shield'}
                busy={busy === 'shield' || busy === 'ad:shield'}
                canWatch={canWatch}
                onBuy={() =>
                  purchase('shield', shieldPrice, () => economy.buy('shield'), t('shop.shieldSaved'))
                }
                onWatch={() => act('ad:shield', () => watchAdFor('shield'), t('shop.shieldSaved'))}
              />
              <ItemRow
                icon={<ChanceIcon size={30} />}
                title={t('shop.continueTitle')}
                description={t('shop.continueDesc')}
                stock={wallet.continues}
                price={continuePrice}
                coins={wallet.coins}
                armed={armed === 'continue'}
                busy={busy === 'continue' || busy === 'ad:continue'}
                canWatch={canWatch}
                last
                onBuy={() =>
                  purchase('continue', continuePrice, () => economy.buy('continue'), t('shop.continueSaved'))
                }
                onWatch={() => act('ad:continue', () => watchAdFor('continue'), t('shop.continueSaved'))}
              />
            </Card>
          </>
        )}
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
        <Text style={styles.walletLabel}>{t('shop.walletCoins')}</Text>
      </View>
      <View style={styles.walletDivider} />
      <View style={styles.walletItem}>
        <ShieldIcon size={20} />
        <Text style={styles.walletValue}>{wallet.shields}</Text>
        <Text style={styles.walletLabel}>{t('shop.walletShields')}</Text>
      </View>
      <View style={styles.walletDivider} />
      <View style={styles.walletItem}>
        <ChanceIcon size={20} />
        <Text style={styles.walletValue}>{wallet.continues}</Text>
        <Text style={styles.walletLabel}>{t('shop.walletChances')}</Text>
      </View>
    </View>
  );
}

function BirdRow({
  bird,
  owned,
  equipped,
  coins,
  armed,
  busy,
  stars,
  upgradeArmed,
  upgradeBusy,
  onUpgrade,
  moneyPrice,
  moneyReady,
  moneyBusy,
  last,
  onBuy,
  onBuyMoney,
  onEquip,
}) {
  // A proxima estrela: quanto custa e o que ela muda no poder. So de passaro
  // comprado, que evolui e ainda nao chegou no maximo.
  const maxStars = bird.maxStars || 0;
  const precos = bird.upgradePrices || [];
  const proximaEstrela = owned && bird.upgradable && stars < maxStars ? precos[stars] : null;
  const poderDeTempo = (bird.powers || []).find((p) => p.levelValues && p.levelValues.length > stars);
  let action;
  if (equipped) {
    action = <Text style={styles.inUse}>{t('common.inUse')}</Text>;
  } else if (owned) {
    action = busy ? (
      <ActivityIndicator color={theme.pillar} />
    ) : (
      <Button title={t('common.use')} variant="ghost" compact onPress={onEquip} />
    );
  } else {
    // O Cometa, por exemplo, e so com dinheiro.
    action = (
      <BuyOptions
        price={bird.price}
        productId={bird.productId}
        coins={coins}
        armed={armed}
        busy={busy}
        moneyPrice={moneyPrice}
        moneyReady={moneyReady}
        moneyBusy={moneyBusy}
        onBuy={onBuy}
        onBuyMoney={onBuyMoney}
      />
    );
  }

  if (owned && proximaEstrela !== null && proximaEstrela !== undefined) {
    action = (
      <View style={styles.buyOptions}>
        {action}
        <PriceButton
          price={proximaEstrela}
          armed={upgradeArmed}
          busy={upgradeBusy}
          short={coins < proximaEstrela}
          onPress={() => onUpgrade(proximaEstrela)}
          label="★"
        />
      </View>
    );
  }

  return (
    <View style={[styles.row, last && styles.last, equipped && styles.rowActive]}>
      <BirdAvatar birdId={bird.id} size={30} />
      <View style={styles.rowTexts}>
        <Text style={styles.rowTitle}>{birdName(bird)}</Text>
        <Text style={styles.rowDesc}>{birdTagline(bird)}</Text>
        {bird.powers && bird.powers.length > 0 ? (
          bird.powers.map((p) => (
            <Text key={p.id} style={styles.ability}>
              {describePower(p)}
            </Text>
          ))
        ) : (
          <Text style={[styles.ability, styles.noPower]}>{t('shop.noPower')}</Text>
        )}
        {maxStars > 0 ? <Stars level={stars} total={maxStars} /> : null}
        {poderDeTempo && owned && stars < maxStars ? (
          <Text style={styles.nextStar}>
            {t('shop.starNow', {
              now: formatSeconds(poderDeTempo.levelValues[stars]),
              next: formatSeconds(poderDeTempo.levelValues[stars + 1]),
            })}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/**
 * A aba das skins: o visual de agora no alto e, por encaixe, cada skin vestida
 * no passaro do jogador. So entram as skins que este app sabe desenhar.
 */
function SkinsTab({ catalog, wallet, armed, busy, onBuy, onBuyMoney, onEquip, onUnequip }) {
  const usando = wallet.equippedSkins || {};
  const donas = wallet.ownedSkins || [];
  const skins = (catalog.skins || []).filter((s) => {
    const look = skinLook(s.id);
    return look && look.slot === s.slot;
  });
  const encaixes = (catalog.skinSlots || []).filter((e) => skins.some((s) => s.slot === e.id));
  const bird = (catalog.birds || []).find((b) => b.id === wallet.equippedBird);

  if (skins.length === 0) {
    return (
      <Card style={styles.notice}>
        <Text style={styles.noticeBody}>{t('shop.noSkins')}</Text>
      </Card>
    );
  }

  const emUso = encaixes
    .map((e) => skins.find((s) => s.id === usando[e.id]))
    .filter(Boolean)
    .map((s) => skinName(s));

  return (
    <>
      <Card style={styles.outfit}>
        <BirdAvatar birdId={wallet.equippedBird} skins={usando} size={60} />
        <View style={styles.rowTexts}>
          <Text style={styles.outfitLabel}>{t('shop.outfitLabel')}</Text>
          <Text style={styles.rowTitle}>{bird ? birdName(bird) : t('shop.yourBird')}</Text>
          <Text style={styles.rowDesc}>{emUso.length > 0 ? emUso.join(' · ') : t('shop.noSkinInUse')}</Text>
        </View>
      </Card>

      {encaixes.map((encaixe) => {
        const doEncaixe = skins.filter((s) => s.slot === encaixe.id);
        return (
          <React.Fragment key={encaixe.id}>
            <SectionTitle>{slotName(encaixe)}</SectionTitle>
            <Card>
              {doEncaixe.map((skin, i) => {
                const id = `skin:${skin.id}`;
                const vestida = usando[skin.slot] === skin.id;
                return (
                  <SkinRow
                    key={skin.id}
                    skin={skin}
                    birdId={wallet.equippedBird}
                    // A skin vestida no passaro, com o que ele ja usa nos outros encaixes.
                    preview={{ ...usando, [skin.slot]: skin.id }}
                    owned={donas.includes(skin.id)}
                    equipped={vestida}
                    coins={wallet.coins}
                    armed={armed === id}
                    busy={busy === id}
                    moneyPrice={billing.priceOf(skin.productId)}
                    moneyReady={billing.isAvailable()}
                    moneyBusy={busy === `money:${skin.id}`}
                    last={i === doEncaixe.length - 1}
                    onBuy={() => onBuy(skin)}
                    onBuyMoney={() => onBuyMoney(skin)}
                    onEquip={() => onEquip(skin)}
                    onUnequip={() => onUnequip(skin)}
                  />
                );
              })}
            </Card>
          </React.Fragment>
        );
      })}
    </>
  );
}

function SkinRow({
  skin,
  birdId,
  preview,
  owned,
  equipped,
  coins,
  armed,
  busy,
  moneyPrice,
  moneyReady,
  moneyBusy,
  last,
  onBuy,
  onBuyMoney,
  onEquip,
  onUnequip,
}) {
  let action;
  if (equipped) {
    action = (
      <View style={styles.buyOptions}>
        <Text style={styles.inUse}>{t('common.inUse')}</Text>
        {busy ? (
          <ActivityIndicator color={theme.pillar} />
        ) : (
          <Button title={t('common.remove')} variant="ghost" compact onPress={onUnequip} />
        )}
      </View>
    );
  } else if (owned) {
    action = busy ? (
      <ActivityIndicator color={theme.pillar} />
    ) : (
      <Button title={t('common.use')} variant="ghost" compact onPress={onEquip} />
    );
  } else {
    action = (
      <BuyOptions
        price={skin.price}
        productId={skin.productId}
        coins={coins}
        armed={armed}
        busy={busy}
        moneyPrice={moneyPrice}
        moneyReady={moneyReady}
        moneyBusy={moneyBusy}
        onBuy={onBuy}
        onBuyMoney={onBuyMoney}
      />
    );
  }

  return (
    <View style={[styles.row, last && styles.last, equipped && styles.rowActive]}>
      <BirdAvatar birdId={birdId} skins={preview} size={38} />
      <View style={styles.rowTexts}>
        <Text style={styles.rowTitle}>{skinName(skin)}</Text>
        <Text style={styles.rowDesc}>{skinTagline(skin)}</Text>
        {owned && !equipped ? <Text style={styles.ability}>{t('shop.inCollection')}</Text> : null}
      </View>
      {action}
    </View>
  );
}

/**
 * Os botoes de compra de um passaro ou de uma skin: moedas, dinheiro ou os
 * dois — o catalogo do servidor diz (price e productId).
 */
function BuyOptions({
  price,
  productId,
  coins,
  armed,
  busy,
  moneyPrice,
  moneyReady,
  moneyBusy,
  onBuy,
  onBuyMoney,
}) {
  const comMoedas = price > 0;
  const comDinheiro = Boolean(productId && moneyPrice);
  const esperandoPreco = Boolean(productId && moneyReady && !moneyPrice);
  return (
    <View style={styles.buyOptions}>
      {comMoedas ? (
        <PriceButton price={price} armed={armed} busy={busy} short={coins < price} onPress={onBuy} />
      ) : null}
      {comDinheiro ? <MoneyButton price={moneyPrice} busy={moneyBusy} onPress={onBuyMoney} /> : null}
      {!comDinheiro && esperandoPreco ? <ActivityIndicator size="small" color={theme.pillar} /> : null}
      {!comMoedas && !comDinheiro && !esperandoPreco ? (
        <Text style={styles.unavailable}>{t('common.unavailableHere')}</Text>
      ) : null}
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
          <Text style={styles.stockLabel}>{t('shop.stocked')}</Text>
        </View>
      </View>
      <View style={styles.itemActions}>
        {price !== null ? (
          <PriceButton price={price} armed={armed} busy={busy} short={coins < price} onPress={onBuy} />
        ) : null}
        {canWatch ? (
          <Button title={t('shop.watchAd')} variant="ghost" compact onPress={busy ? undefined : onWatch} />
        ) : null}
      </View>
    </View>
  );
}

/** Botao da compra com dinheiro: o preco que o Google Play informou. */
function MoneyButton({ price, busy, onPress }) {
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [styles.price, styles.money, pressed && { opacity: 0.75 }]}
    >
      {busy ? <ActivityIndicator size="small" color={theme.pillar} /> : <Text style={styles.moneyText}>{price}</Text>}
    </Pressable>
  );
}

/** Botao de preco. Primeiro toque arma, segundo compra; sem saldo, fica apagado. */
function PriceButton({ price, armed, busy, short, onPress, label }) {
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
        <Text style={styles.priceArmedText}>{t('common.confirmPrice', { price })}</Text>
      ) : (
        <>
          {label ? <Text style={styles.priceText}>{label}</Text> : <CoinFace size={14} />}
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
  tabs: { marginTop: 14, marginBottom: 0 },

  outfit: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  outfitLabel: { color: theme.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, marginBottom: 2 },

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
  money: { backgroundColor: 'rgba(46,230,197,0.12)', borderColor: 'rgba(46,230,197,0.6)' },
  moneyText: { color: theme.pillar, fontSize: 14, fontWeight: '900' },
  buyOptions: { alignItems: 'flex-end', gap: 6 },
  unavailable: { color: theme.textDim, fontSize: 11, textAlign: 'right', lineHeight: 15 },
  nextStar: { color: theme.textDim, fontSize: 11, marginTop: 3 },
  priceShort: { opacity: 0.45 },
  priceText: { color: theme.bird, fontSize: 14, fontWeight: '900' },
  priceArmedText: { color: '#1A1330', fontSize: 13, fontWeight: '900' },

  error: { color: theme.danger, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  success: { color: theme.pillar, fontSize: 13, fontWeight: '700', textAlign: 'center' },
});

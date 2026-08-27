import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import Screen, { Card } from '../ui/Screen';
import Button from '../ui/Button';
import { theme } from '../ui/theme';
import { loadRuns } from '../services/scores';
import {
  UNAVAILABLE_REASON,
  availability,
  getPlayer,
  loadTopScores,
  showNativeLeaderboard,
} from '../services/playGames';

const TABS = [
  { id: 'global', label: 'Global' },
  { id: 'local', label: 'Seus voos' },
];

export default function LeaderboardScreen({ onBack, onOpenSettings }) {
  const [tab, setTab] = useState('global');
  const [runs, setRuns] = useState(null);
  const [global, setGlobal] = useState(null);
  const [player, setPlayer] = useState(null);
  const [loadingGlobal, setLoadingGlobal] = useState(false);

  const status = availability();

  useEffect(() => {
    loadRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

  const refreshGlobal = useCallback(async () => {
    if (!status.available) {
      setGlobal([]);
      return;
    }
    setLoadingGlobal(true);
    const [rows, me] = await Promise.all([loadTopScores(25), getPlayer()]);
    setGlobal(rows);
    setPlayer(me);
    setLoadingGlobal(false);
  }, [status.available]);

  useEffect(() => {
    refreshGlobal();
  }, [refreshGlobal]);

  return (
    <Screen title="Ranking" onBack={onBack}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={({ pressed }) => [
              styles.tab,
              tab === t.id && styles.tabActive,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={[styles.tabLabel, tab === t.id && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'global' ? (
        <GlobalTab
          status={status}
          rows={global}
          player={player}
          loading={loadingGlobal}
          onRefresh={refreshGlobal}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <LocalTab runs={runs} />
      )}
    </Screen>
  );
}

// ------------------------------------------------------------------- global

const UNAVAILABLE_COPY = {
  [UNAVAILABLE_REASON.PLATFORM]: {
    title: 'So no Android',
    body:
      'O Google Play Jogos e um servico Android. Neste aparelho o ranking global ' +
      'nao existe, mas a aba "Seus voos" continua funcionando normalmente.',
  },
  [UNAVAILABLE_REASON.NO_NATIVE_MODULE]: {
    title: 'Precisa de uma build propria',
    body:
      'O ranking com outros jogadores da Play Store depende de codigo nativo do ' +
      'Google Play Jogos, que nao existe dentro do Expo Go. Ele liga sozinho ' +
      'quando o jogo roda numa build gerada com EAS Build e registrada no seu ' +
      'Google Play Console. O passo a passo esta no README.',
  },
  [UNAVAILABLE_REASON.NO_LEADERBOARD_ID]: {
    title: 'Falta cadastrar o placar',
    body:
      'O modulo nativo esta presente, mas o ID do placar ainda nao foi preenchido. ' +
      'Crie um leaderboard no Google Play Console e cole o ID em ' +
      'src/services/playGames.js.',
  },
};

function GlobalTab({ status, rows, player, loading, onRefresh, onOpenSettings }) {
  if (!status.available) {
    const copy = UNAVAILABLE_COPY[status.reason] ?? UNAVAILABLE_COPY[UNAVAILABLE_REASON.NO_NATIVE_MODULE];
    return (
      <Card style={styles.notice}>
        <Text style={styles.noticeTitle}>{copy.title}</Text>
        <Text style={styles.noticeBody}>{copy.body}</Text>
        {onOpenSettings ? (
          <Button
            title="Ver em Configuracoes"
            variant="ghost"
            compact
            onPress={onOpenSettings}
            style={{ marginTop: 16, alignSelf: 'flex-start' }}
          />
        ) : null}
      </Card>
    );
  }

  if (loading || rows === null) {
    return (
      <Card style={styles.centerCard}>
        <ActivityIndicator color={theme.pillar} />
        <Text style={styles.emptyText}>Carregando o placar...</Text>
      </Card>
    );
  }

  if (!player?.signedIn) {
    return (
      <Card style={styles.notice}>
        <Text style={styles.noticeTitle}>Conta nao conectada</Text>
        <Text style={styles.noticeBody}>
          Conecte sua conta do Google Play Jogos para ver o placar e aparecer nele.
        </Text>
        <Button
          title="Ir para Configuracoes"
          compact
          onPress={onOpenSettings}
          style={{ marginTop: 16, alignSelf: 'flex-start' }}
        />
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card style={styles.centerCard}>
        <Text style={styles.emptyText}>Ninguem pontuou ainda. Seja o primeiro.</Text>
        <Button title="Atualizar" variant="ghost" compact onPress={onRefresh} style={{ marginTop: 14 }} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        {rows.map((row, i) => (
          <Entry
            key={`${row.rank}-${row.name}`}
            rank={row.rank}
            name={row.name}
            score={row.score}
            highlight={row.isPlayer}
            last={i === rows.length - 1}
          />
        ))}
      </Card>
      <View style={styles.actions}>
        <Button title="Atualizar" variant="ghost" compact onPress={onRefresh} />
        <Button title="Abrir no Play Jogos" variant="ghost" compact onPress={showNativeLeaderboard} />
      </View>
    </>
  );
}

// -------------------------------------------------------------------- local

function LocalTab({ runs }) {
  if (runs === null) {
    return (
      <Card style={styles.centerCard}>
        <ActivityIndicator color={theme.pillar} />
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <Card style={styles.centerCard}>
        <Text style={styles.emptyText}>
          Nenhum voo registrado ainda. Jogue uma partida e ela aparece aqui.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      {runs.map((run, i) => (
        <Entry
          key={`${run.at}-${i}`}
          rank={i + 1}
          name={formatDate(run.at)}
          score={run.score}
          badge={run.landscape ? 'paisagem' : 'retrato'}
          highlight={i === 0}
          last={i === runs.length - 1}
        />
      ))}
    </Card>
  );
}

function formatDate(at) {
  try {
    return new Date(at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return '';
  }
}

// -------------------------------------------------------------------- linha

const MEDALS = ['#FFD54A', '#D8DEF2', '#E2913F'];

function Entry({ rank, name, score, badge, highlight, last }) {
  const medal = rank <= 3 ? MEDALS[rank - 1] : null;
  return (
    <View style={[styles.entry, last && { borderBottomWidth: 0 }, highlight && styles.entryHighlight]}>
      <View style={[styles.rank, medal && { backgroundColor: medal }]}>
        <Text style={[styles.rankText, medal && { color: '#1A1330' }]}>{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.entryName} numberOfLines={1}>
          {name}
        </Text>
        {badge ? <Text style={styles.entryBadge}>{badge}</Text> : null}
      </View>
      <Text style={styles.entryScore}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    marginTop: 6,
    marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: 'rgba(46,230,197,0.18)' },
  tabLabel: { color: theme.textDim, fontSize: 14, fontWeight: '700' },
  tabLabelActive: { color: theme.pillar },

  notice: { padding: 20 },
  noticeTitle: { color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  noticeBody: { color: theme.textDim, fontSize: 13, lineHeight: 20 },

  centerCard: { padding: 28, alignItems: 'center' },
  emptyText: { color: theme.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' },

  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  entryHighlight: { backgroundColor: 'rgba(46,230,197,0.09)' },
  rank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  rankText: { color: theme.textDim, fontSize: 13, fontWeight: '800' },
  entryName: { color: theme.text, fontSize: 15, fontWeight: '600' },
  entryBadge: {
    color: theme.textDim,
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  entryScore: { color: theme.bird, fontSize: 19, fontWeight: '900', minWidth: 44, textAlign: 'right' },
});

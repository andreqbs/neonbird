import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Screen, { Card } from '../ui/Screen';
import Button from '../ui/Button';
import { theme } from '../ui/theme';
import usePlayer from '../hooks/usePlayer';
import cloud from '../services/cloud';
import { loadRuns } from '../services/scores';
import {
  SEASON_STATE,
  currentSeason,
  formatRemaining,
  msUntilNext,
  seasonLabel,
} from '../services/season';

const TABS = [
  { id: 'players', label: 'Individual' },
  { id: 'groups', label: 'Grupo' },
  { id: 'local', label: 'Seus voos' },
];

/** Quantos cabem num grupo. O servidor tambem recusa o nono (server/store.go). */
const GROUP_MAX = 8;

export default function LeaderboardScreen({ onBack, onOpenSettings }) {
  const [tab, setTab] = useState('players');
  const { player } = usePlayer();

  const [runs, setRuns] = useState(null);
  const [players, setPlayers] = useState(null);
  const [groups, setGroups] = useState(null);
  const [myGroup, setMyGroup] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const season = currentSeason();
  const online = cloud.isConfigured();

  useEffect(() => {
    loadRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

  /** Busca as tres listas de uma vez: quem abre o ranking quer ver tudo. */
  const atualizar = useCallback(async () => {
    if (!online || !player) return;
    setCarregando(true);
    setErro(null);
    const [rp, rg, rm] = await Promise.all([
      cloud.topPlayers(50),
      cloud.topGroups(50),
      cloud.myGroup(),
    ]);
    if (rp.ok) setPlayers(rp.data?.rows ?? []);
    else setErro(rp.error);
    if (rg.ok) setGroups(rg.data?.rows ?? []);
    if (rm.ok) setMyGroup(rm.data?.group ?? null);
    setCarregando(false);
  }, [online, player]);

  useEffect(() => {
    atualizar();
  }, [atualizar]);

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

      {tab !== 'local' && <SeasonBar season={season} />}

      {tab === 'players' && (
        <PlayersTab
          online={online}
          rows={players}
          me={player}
          loading={carregando}
          erro={erro}
          onRefresh={atualizar}
          onOpenSettings={onOpenSettings}
        />
      )}

      {tab === 'groups' && (
        <GroupsTab
          online={online}
          me={player}
          group={myGroup}
          rows={groups}
          loading={carregando}
          onRefresh={atualizar}
          onOpenSettings={onOpenSettings}
        />
      )}

      {tab === 'local' && <LocalTab runs={runs} />}
    </Screen>
  );
}

// ------------------------------------------------------------------- rodada

/**
 * A faixa da rodada. Diz de quando ate quando ela vale e quanto falta — sem
 * isso o ranking e um numero solto, e ninguem sabe se ainda da tempo de jogar.
 */
function SeasonBar({ season }) {
  const apurando = season.state === SEASON_STATE.COUNTING;
  const falta = formatRemaining(msUntilNext(season));

  return (
    <View style={[styles.season, apurando && styles.seasonCounting]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.seasonLabel}>RODADA · {seasonLabel(season)}</Text>
        <Text style={styles.seasonHint}>
          {apurando
            ? `Rodada fechada para apuração. A próxima abre em ${falta}.`
            : `Termina em ${falta} · domingo às 18h`}
        </Text>
      </View>
      {apurando ? <Text style={styles.seasonBadge}>APURANDO</Text> : null}
    </View>
  );
}

// -------------------------------------------------------------- sem servidor

function OfflineNotice({ onOpenSettings }) {
  return (
    <Card style={styles.notice}>
      <Text style={styles.noticeTitle}>Ranking online desligado</Text>
      <Text style={styles.noticeBody}>
        Este app ainda não está ligado a um servidor, então grupos e ranking entre jogadores não
        funcionam. Seu recorde e o histórico continuam salvos aqui no aparelho, na aba “Seus voos”.
      </Text>
      <Text style={styles.noticeBody}>
        Para ligar: suba o servidor da pasta <Text style={styles.mono}>server/</Text> (é um{' '}
        <Text style={styles.mono}>docker compose up -d</Text>) e escreva o endereço dele em{' '}
        <Text style={styles.mono}>src/services/cloud.js</Text>.
      </Text>
    </Card>
  );
}

// --------------------------------------------------------- ranking individual

function PlayersTab({ online, rows, me, loading, erro, onRefresh, onOpenSettings }) {
  if (!online) return <OfflineNotice onOpenSettings={onOpenSettings} />;
  if (loading && rows === null) return <Loading />;

  if (erro) {
    return (
      <Card style={styles.centerCard}>
        <Text style={styles.emptyText}>Não deu para carregar o ranking ({erro}).</Text>
        <Button title="Tentar de novo" variant="ghost" compact onPress={onRefresh} style={{ marginTop: 14 }} />
      </Card>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Card style={styles.centerCard}>
        <Text style={styles.emptyText}>Ninguém pontuou nesta rodada ainda. Seja o primeiro.</Text>
        <Button title="Atualizar" variant="ghost" compact onPress={onRefresh} style={{ marginTop: 14 }} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        {rows.map((row, i) => (
          <Entry
            key={row.id}
            rank={i + 1}
            name={row.name}
            score={row.total}
            badge={`melhor voo: ${row.best}`}
            highlight={me && row.id === me.id}
            last={i === rows.length - 1}
          />
        ))}
      </Card>
      <Text style={styles.footnote}>
        A pontuação da rodada é a soma de todas as suas partidas nela.
      </Text>
      <View style={styles.actions}>
        <Button title="Atualizar" variant="ghost" compact onPress={onRefresh} />
      </View>
    </>
  );
}

// ------------------------------------------------------------------- grupos

function GroupsTab({ online, me, group, rows, loading, onRefresh, onOpenSettings }) {
  if (!online) return <OfflineNotice onOpenSettings={onOpenSettings} />;
  if (loading && rows === null && group === null) return <Loading />;

  return (
    <>
      {group ? (
        <MyGroup group={group} me={me} onChanged={onRefresh} />
      ) : (
        <CreateGroup onCreated={onRefresh} />
      )}

      {rows && rows.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>RANKING DOS GRUPOS</Text>
          <Card>
            {rows.map((row, i) => (
              <Entry
                key={row.id}
                rank={i + 1}
                name={row.name}
                score={row.total}
                badge={`${row.members} ${row.members === 1 ? 'jogador' : 'jogadores'} · líder ${row.leader}`}
                highlight={group && row.id === group.id}
                last={i === rows.length - 1}
                crest={row.crest}
              />
            ))}
          </Card>
        </>
      ) : null}

      <View style={styles.actions}>
        <Button title="Atualizar" variant="ghost" compact onPress={onRefresh} />
      </View>
    </>
  );
}

/** Sem grupo: o lugar do ranking vira o convite para criar um. */
function CreateGroup({ onCreated }) {
  const [nome, setNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState(null);

  const criar = useCallback(async () => {
    const limpo = nome.trim();
    if (limpo.length < 2) {
      setErro('Dê um nome com pelo menos 2 letras.');
      return;
    }
    setCriando(true);
    setErro(null);
    const r = await cloud.createGroup(limpo);
    setCriando(false);
    if (r.ok) {
      setNome('');
      onCreated();
    } else {
      setErro(r.error);
    }
  }, [nome, onCreated]);

  return (
    <Card style={styles.notice}>
      <Text style={styles.noticeTitle}>Você ainda não tem grupo</Text>
      <Text style={styles.noticeBody}>
        Crie um e chame até {GROUP_MAX} jogadores. A pontuação do grupo é a soma do que todo mundo
        fizer na rodada — e você continua no ranking individual do mesmo jeito.
      </Text>

      <TextInput
        value={nome}
        onChangeText={setNome}
        placeholder="Nome do grupo"
        placeholderTextColor="rgba(150,161,206,0.6)"
        maxLength={24}
        returnKeyType="done"
        onSubmitEditing={criar}
        style={styles.input}
      />

      {erro ? <Text style={styles.error}>{erro}</Text> : null}

      <Button
        title={criando ? 'Criando...' : 'Criar grupo'}
        compact
        onPress={criar}
        style={{ marginTop: 14, alignSelf: 'flex-start' }}
      />
      <Text style={styles.noticeFoot}>
        Quem cria vira o líder — só ele chama gente nova, e é o único com a coroa.
      </Text>
    </Card>
  );
}

/** Com grupo: escudo, soma, membros e (para o líder) o campo de convite. */
function MyGroup({ group, me, onChanged }) {
  const souLider = me && group.leaderId === me.id;
  const cheio = group.members.length >= GROUP_MAX;

  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const adicionar = useCallback(async () => {
    const limpo = codigo.trim();
    if (limpo.length < 30) {
      setMsg({ erro: true, texto: 'Cole o código completo do jogador.' });
      return;
    }
    setOcupado(true);
    const r = await cloud.addMember(limpo);
    setOcupado(false);
    if (r.ok) {
      setCodigo('');
      setMsg({ erro: false, texto: `${r.data?.added ?? 'Jogador'} entrou no grupo.` });
      onChanged();
    } else {
      setMsg({ erro: true, texto: r.error });
    }
  }, [codigo, onChanged]);

  const sair = useCallback(async () => {
    setOcupado(true);
    await cloud.leaveGroup();
    setOcupado(false);
    onChanged();
  }, [onChanged]);

  return (
    <Card>
      <View style={styles.groupHead}>
        <Crest name={group.name} crest={group.crest} />
        <View style={{ flex: 1 }}>
          <Text style={styles.groupName} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.groupMeta}>
            {group.members.length}/{GROUP_MAX} jogadores
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.groupTotal}>{group.total}</Text>
          <Text style={styles.groupMeta}>pontos</Text>
        </View>
      </View>

      {group.members.map((m, i) => (
        <Entry
          key={m.id}
          rank={i + 1}
          name={m.leader ? `👑 ${m.name}` : m.name}
          score={m.total}
          badge={`melhor voo: ${m.best}`}
          highlight={me && m.id === me.id}
          last={i === group.members.length - 1 && !souLider}
        />
      ))}

      {souLider ? (
        <View style={styles.inviteBox}>
          <Text style={styles.inviteTitle}>Chamar alguém</Text>
          <Text style={styles.inviteHint}>
            {cheio
              ? 'O grupo está cheio. Para chamar outra pessoa, alguém precisa sair.'
              : 'Peça o código do jogador (ele acha em Configurações) e cole aqui.'}
          </Text>
          <TextInput
            value={codigo}
            onChangeText={setCodigo}
            placeholder="Código do jogador"
            placeholderTextColor="rgba(150,161,206,0.6)"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!cheio && !ocupado}
            returnKeyType="done"
            onSubmitEditing={adicionar}
            style={[styles.input, cheio && { opacity: 0.5 }]}
          />
          {msg ? (
            <Text style={msg.erro ? styles.error : styles.success}>{msg.texto}</Text>
          ) : null}
          <Button
            title={ocupado ? 'Aguarde...' : 'Adicionar ao grupo'}
            compact
            onPress={adicionar}
            style={{ marginTop: 12, alignSelf: 'flex-start', opacity: cheio ? 0.5 : 1 }}
          />
        </View>
      ) : null}

      <View style={styles.groupFoot}>
        <Button title="Sair do grupo" variant="ghost" compact onPress={sair} />
      </View>
    </Card>
  );
}

/**
 * Escudo do grupo. Por enquanto e a inicial do nome num selo — o campo `crest`
 * ja existe no banco para quando as artes prontas entrarem, e ai so o desenho
 * daqui muda.
 */
function Crest({ name, crest }) {
  const inicial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={styles.crest}>
      <Text style={styles.crestText}>{crest ? '★' : inicial}</Text>
    </View>
  );
}

// -------------------------------------------------------------------- local

function LocalTab({ runs }) {
  if (runs === null) return <Loading />;

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

// -------------------------------------------------------------------- pecas

function Loading() {
  return (
    <Card style={styles.centerCard}>
      <ActivityIndicator color={theme.pillar} />
      <Text style={styles.emptyText}>Carregando...</Text>
    </Card>
  );
}

const MEDALS = ['#FFD54A', '#D8DEF2', '#E2913F'];

function Entry({ rank, name, score, badge, highlight, last, crest }) {
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
        {badge ? (
          <Text style={styles.entryBadge} numberOfLines={1}>
            {badge}
          </Text>
        ) : null}
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
    marginBottom: 14,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: 'rgba(46,230,197,0.18)' },
  tabLabel: { color: theme.textDim, fontSize: 14, fontWeight: '700' },
  tabLabelActive: { color: theme.pillar },

  season: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(46,230,197,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(46,230,197,0.25)',
    marginBottom: 14,
  },
  seasonCounting: {
    backgroundColor: 'rgba(255,213,74,0.08)',
    borderColor: 'rgba(255,213,74,0.35)',
  },
  seasonLabel: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  seasonHint: { color: theme.textDim, fontSize: 12, marginTop: 3 },
  seasonBadge: {
    color: theme.bird,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },

  notice: { padding: 20, gap: 10 },
  noticeTitle: { color: theme.text, fontSize: 16, fontWeight: '800' },
  noticeBody: { color: theme.textDim, fontSize: 13, lineHeight: 20 },
  noticeFoot: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 12 },
  mono: { color: theme.pillar, fontSize: 12 },

  centerCard: { padding: 28, alignItems: 'center' },
  emptyText: { color: theme.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  footnote: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginHorizontal: 4,
  },
  sectionLabel: {
    color: theme.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 22,
    marginBottom: 10,
    marginLeft: 4,
  },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' },

  input: {
    marginTop: 12,
    color: theme.text,
    fontSize: 15,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  error: { color: theme.danger, fontSize: 12, lineHeight: 17, marginTop: 8 },
  success: { color: theme.pillar, fontSize: 12, lineHeight: 17, marginTop: 8 },

  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  groupName: { color: theme.text, fontSize: 18, fontWeight: '800' },
  groupMeta: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  groupTotal: { color: theme.bird, fontSize: 24, fontWeight: '900' },
  groupFoot: {
    padding: 14,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },

  crest: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46,230,197,0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(46,230,197,0.5)',
  },
  crestText: { color: theme.pillar, fontSize: 20, fontWeight: '900' },

  inviteBox: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  inviteTitle: { color: theme.text, fontSize: 14, fontWeight: '800' },
  inviteHint: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 4 },

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
  },
  entryScore: { color: theme.bird, fontSize: 19, fontWeight: '900', minWidth: 44, textAlign: 'right' },
});

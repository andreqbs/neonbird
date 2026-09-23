-- Major Flyer — banco do servidor.
--
-- Roda sozinho na subida do servidor (store.go faz o embed deste arquivo). E
-- idempotente de proposito: subir de novo, ou subir duas instancias ao mesmo
-- tempo, nao apaga nem duplica nada.
--
-- A regra que importa no ranking esta no indice `one_group_per_season`: um
-- jogador em um grupo por rodada, garantido pelo banco. Regra que vive so no
-- aplicativo e regra que da para burlar com um cliente modificado.

create table if not exists players (
  id          uuid        primary key,
  secret_hash bytea       not null,
  name        text        not null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now()
);

create table if not exists groups (
  id         uuid        primary key,
  season_id  text        not null,
  name       text        not null,
  crest      text        not null default '',
  leader_id  uuid        not null references players (id),
  created_at timestamptz not null default now()
);

create index if not exists groups_season on groups (season_id);

create table if not exists group_members (
  group_id  uuid        not null references groups (id) on delete cascade,
  player_id uuid        not null references players (id),
  season_id text        not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, player_id)
);

-- Um grupo por jogador por rodada. E este indice, e nao um `if` no servidor,
-- que segura a regra quando dois convites chegam no mesmo instante.
create unique index if not exists one_group_per_season
  on group_members (player_id, season_id);

-- Pontos que valem no ranking da rodada. So entram aqui partidas FECHADAS no
-- servidor (game_sessions) — nunca um placar solto mandado pelo app.
create table if not exists runs (
  id         bigserial   primary key,
  player_id  uuid        not null references players (id),
  season_id  text        not null,
  points     integer     not null check (points > 0),
  created_at timestamptz not null default now()
);

create index if not exists runs_season_player on runs (season_id, player_id);
create index if not exists runs_player_recent on runs (player_id, created_at desc);

-- ------------------------------------------------------------------ economia
--
-- Tudo o que o jogador ganha ou gasta mora aqui, e so aqui: o aplicativo nao
-- guarda moeda, vida nem item no aparelho. Cada mudanca de saldo acontece numa
-- transacao com a linha da carteira travada (`for update`), entao dois toques
-- no mesmo instante nao gastam a mesma moeda duas vezes — e os `check` abaixo
-- sao a ultima barreira se algum dia um bug tentar deixar saldo negativo.

create table if not exists wallets (
  player_id     uuid        primary key references players (id),
  coins         integer     not null default 0 check (coins >= 0),
  lives         integer     not null default 5 check (lives >= 0),
  shields       integer     not null default 0 check (shields >= 0),
  continues     integer     not null default 0 check (continues >= 0),
  equipped_bird text        not null default 'classic',
  flight_ms     bigint      not null default 0 check (flight_ms >= 0),
  updated_at    timestamptz not null default now()
);

-- Tempo de voo somado de todas as partidas, em ms: so o tempo voando de fato.
-- Nao e saldo (nao se gasta nem se compra), entao nao passa pelo livro-razao; a
-- conta de cada partida fica em game_sessions.flight_ms. A coluna chegou depois
-- da tabela: banco que ja estava no ar ganha aqui.
alter table wallets add column if not exists flight_ms bigint not null default 0 check (flight_ms >= 0);

-- O passaro de sempre nao aparece aqui: todo jogador ja o tem.
create table if not exists owned_birds (
  player_id   uuid        not null references players (id),
  bird_id     text        not null,
  acquired_at timestamptz not null default now(),
  primary key (player_id, bird_id)
);

-- A partida aberta no servidor.
--
-- Abrir custa uma vida e sorteia a semente das moedas; fechar confere o placar
-- e as moedas contra essa semente e contra o relogio DESTE servidor. Status:
-- open, finished, abandoned (o jogador abriu outra antes de fechar esta),
-- expired (aberta tempo demais) e rejected (placar impossivel).
create table if not exists game_sessions (
  id             uuid        primary key,
  player_id      uuid        not null references players (id),
  seed           bigint      not null,
  status         text        not null default 'open',
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  points         integer,
  coins          integer,
  stage_bonus    integer,
  ranked         boolean     not null default false,
  flight_ms      bigint      not null default 0,
  integrity      text        not null default '',
  bird           text        not null default 'classic',
  continues_used integer     not null default 0
);

-- Colunas que chegaram depois da primeira versao: `create table if not exists`
-- nao mexe em tabela que ja existe, entao o banco que ja estava no ar ganha as
-- colunas aqui. `flight_ms` e o tempo voando de fato nesta partida: medido no
-- aparelho e limitado pelo servidor ao tempo desde a abertura. `integrity` e o
-- resultado da verificacao de integridade no fechamento (integrity.go): ok,
-- off, skipped, missing, failed:<motivo> ou error:<motivo>. `bird` e o passaro
-- escolhido na abertura: os poderes dele (catalog.go) valem a partida inteira.
alter table game_sessions add column if not exists ranked boolean not null default false;
alter table game_sessions add column if not exists flight_ms bigint not null default 0;
alter table game_sessions add column if not exists integrity text not null default '';
alter table game_sessions add column if not exists bird text not null default 'classic';

create index if not exists game_sessions_open on game_sessions (player_id) where status = 'open';

-- Livro-razao: cada entrada e uma mudanca de saldo, com o motivo e a referencia
-- (partida, passaro, transacao do anuncio). Nunca e apagado nem editado. E o que
-- responde "de onde vieram essas moedas?" quando alguem reclamar — ou quando
-- alguem precisar ser investigado.
create table if not exists ledger (
  id         bigserial   primary key,
  player_id  uuid        not null references players (id),
  kind       text        not null,
  coins      integer     not null default 0,
  lives      integer     not null default 0,
  shields    integer     not null default 0,
  continues  integer     not null default 0,
  ref        text        not null default '',
  created_at timestamptz not null default now()
);

create index if not exists ledger_player on ledger (player_id, created_at desc);

-- Compras com dinheiro (Google Play), uma linha por compra, pelo token que o
-- Google da a ela (billing.go). `state`: granted (o passaro esta na conta) ou
-- voided (estornada ou cancelada: o passaro saiu). `test` marca compra feita
-- com licenca de teste do Play Console, que nao cobra ninguem.
create table if not exists bird_purchases (
  purchase_token text        primary key,
  player_id      uuid        not null references players (id),
  bird_id        text        not null,
  order_id       text        not null default '',
  state          text        not null default 'granted' check (state in ('granted', 'voided')),
  test           boolean     not null default false,
  purchased_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists bird_purchases_player on bird_purchases (player_id);

-- O passaro comprado com dinheiro guarda o token da compra: e ele que diz qual
-- passaro sai num estorno ou quando a compra muda de conta. Comprado com moedas,
-- fica vazio.
alter table owned_birds add column if not exists purchase_token text;

-- As estrelas do passaro: cada uma comprada com moedas estica o tempo do poder
-- dele (catalog.go). Passaro recem-comprado comeca em 0.
alter table owned_birds add column if not exists level integer not null default 0;

-- Video premiado confirmado pelo GOOGLE (SSV). Uma linha por transacao: a chave
-- primaria faz o mesmo aviso repetido — o Google tenta de novo quando nao
-- recebe resposta — valer uma vez so. O app troca cada linha por um premio
-- (vidas, escudo ou nova chance) em ate 30 minutos.
create table if not exists ad_views (
  transaction_id text        primary key,
  player_id      uuid        not null references players (id),
  ad_unit        text        not null default '',
  reward_amount  integer     not null default 0,
  verified_at    timestamptz not null default now(),
  claimed_at     timestamptz,
  claimed_for    text
);

create index if not exists ad_views_unclaimed on ad_views (player_id, verified_at) where claimed_at is null;

-- Registro de acesso: de que IP cada jogador usou o jogo, e quando (access.go).
-- Uma linha por visita — pedidos do mesmo IP com menos de 30 min de pausa
-- estendem a mesma linha; IP novo ou pausa maior abre outra. Serve para validar
-- e proteger o jogo, e e o registro que o Marco Civil da Internet (art. 15) pede.
-- O servidor apaga sozinho a visita que terminou ha mais de 6 meses.
create table if not exists player_access (
  id         bigserial   primary key,
  player_id  uuid        not null references players (id),
  ip         inet        not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create index if not exists player_access_visit on player_access (player_id, ip, last_seen desc);
create index if not exists player_access_ip on player_access (ip);
create index if not exists player_access_last on player_access (last_seen);

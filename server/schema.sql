-- Major Flyer — banco do ranking.
--
-- Roda sozinho na subida do servidor (store.go faz o embed deste arquivo). E
-- idempotente de proposito: subir de novo, ou subir duas instancias ao mesmo
-- tempo, nao apaga nem duplica nada.
--
-- A regra que importa esta no indice `one_group_per_season`: um jogador em um
-- grupo por rodada, garantido pelo banco. Regra que vive so no aplicativo e
-- regra que da para burlar com um cliente modificado.

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

create table if not exists runs (
  id         bigserial   primary key,
  player_id  uuid        not null references players (id),
  season_id  text        not null,
  points     integer     not null check (points > 0),
  created_at timestamptz not null default now()
);

-- Os dois caminhos que o ranking percorre: "todos os pontos da rodada" e
-- "quando foi a ultima partida deste jogador" (o intervalo minimo entre
-- partidas).
create index if not exists runs_season_player on runs (season_id, player_id);
create index if not exists runs_player_recent on runs (player_id, created_at desc);

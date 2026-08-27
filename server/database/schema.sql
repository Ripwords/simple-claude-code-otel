create schema if not exists telemetry;

create table if not exists telemetry.device (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null unique,
  token_hash   text        not null unique,
  token_prefix text        not null,
  created_at   timestamptz not null default now(),
  first_seen   timestamptz,
  last_seen_at timestamptz,
  revoked_at   timestamptz,

  -- Claimed on first telemetry and enforced afterwards, so signing into a different
  -- Claude Code account on this machine stops reporting instead of quietly mixing
  -- another account's spend into this machine's numbers.
  account_uuid  text,
  account_email text,

  -- The last rejected attempt, kept so the dashboard can say why a machine went quiet.
  rejected_account_uuid text,
  rejected_at           timestamptz,
  rejected_count        integer not null default 0
);

alter table telemetry.device add column if not exists account_uuid text;
alter table telemetry.device add column if not exists account_email text;
alter table telemetry.device add column if not exists rejected_account_uuid text;
alter table telemetry.device add column if not exists rejected_at timestamptz;
alter table telemetry.device add column if not exists rejected_count integer not null default 0;

create table if not exists telemetry.session (
  session_id   text        primary key,
  device_id    uuid        not null references telemetry.device (id) on delete cascade,
  started_at   timestamptz not null,
  last_seen_at timestamptz not null,
  attrs        jsonb       not null default '{}'::jsonb
);

create index if not exists session_device_started_idx
  on telemetry.session (device_id, started_at desc);

create table if not exists telemetry.metric_point (
  dedupe_key uuid             primary key,
  ts         timestamptz      not null,
  device_id  uuid             not null references telemetry.device (id) on delete cascade,
  session_id text,
  metric     text             not null,
  model      text,
  value      double precision not null,
  attrs      jsonb            not null default '{}'::jsonb
);

create index if not exists metric_point_metric_ts_idx
  on telemetry.metric_point (metric, ts desc);
create index if not exists metric_point_device_idx
  on telemetry.metric_point (device_id);
create index if not exists metric_point_ts_brin_idx
  on telemetry.metric_point using brin (ts) with (pages_per_range = 32);

create table if not exists telemetry.event (
  dedupe_key  uuid        primary key,
  ts          timestamptz not null,
  device_id   uuid        not null references telemetry.device (id) on delete cascade,
  session_id  text,
  name        text        not null,
  model       text,
  duration_ms integer,
  attrs       jsonb       not null default '{}'::jsonb
);

create index if not exists event_name_ts_idx
  on telemetry.event (name, ts desc);
create index if not exists event_device_idx
  on telemetry.event (device_id);
create index if not exists event_ts_brin_idx
  on telemetry.event using brin (ts) with (pages_per_range = 32);
create index if not exists event_attrs_gin_idx
  on telemetry.event using gin (attrs jsonb_path_ops);

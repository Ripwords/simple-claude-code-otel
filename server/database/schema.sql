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
  rejected_account_uuid  text,
  rejected_account_email text,
  rejected_at            timestamptz,
  rejected_count         integer not null default 0
);

alter table telemetry.device add column if not exists account_uuid text;
alter table telemetry.device add column if not exists account_email text;
alter table telemetry.device add column if not exists rejected_account_uuid text;
alter table telemetry.device add column if not exists rejected_account_email text;
alter table telemetry.device add column if not exists rejected_at timestamptz;
alter table telemetry.device add column if not exists rejected_count integer not null default 0;

-- An account on this list may report through any machine's token, not just its own.
create table if not exists telemetry.allowed_email (
  email      text        primary key,
  created_at timestamptz not null default now()
);

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
-- Never served a query. Every dashboard predicate is attrs->>'key' extraction, which no GIN
-- opclass can answer -- jsonb_path_ops indexes containment (@>, @?, @@) and nothing else.
-- It cost 63 MB and one index write per ingested row to answer nothing.
drop index if exists telemetry.event_attrs_gin_idx;

-- Retention deletes a day's rows in one statement. Without a low scale factor autovacuum waits
-- for 20% of the table to turn dead before running, so the heap ratchets upward between sweeps
-- instead of settling. Freed pages have to return to the free space map for the next day to
-- reuse them, because a plain delete never gives them back to the filesystem.
alter table telemetry.event set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table telemetry.metric_point set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);

-- Raw telemetry is kept for days, these summaries for a year. Everything the dashboard asks
-- about a range older than the raw window is answered from here.
--
-- The grain is the UTC day. model and attr_key carry an empty-string sentinel rather than null
-- because they sit in the primary key, and because null never collides -- a re-rolled day would
-- accumulate duplicate rows instead of converging on the same answer.
--
-- value is numeric, not double precision: float addition is not associative, so a rolled-up sum
-- and a raw sum over the same rows disagree in the last bits. Exact arithmetic is what lets
-- verify-rollup assert equality rather than a tolerance.
create table if not exists telemetry.metric_daily (
  day       date    not null,
  device_id uuid    not null references telemetry.device (id) on delete cascade,
  metric    text    not null,
  model     text    not null default '',
  attr_key  text    not null default '',
  value     numeric not null,
  points    bigint  not null,
  primary key (day, device_id, metric, model, attr_key)
);

create index if not exists metric_daily_metric_day_idx
  on telemetry.metric_daily (metric, day);

create table if not exists telemetry.event_daily (
  day       date   not null,
  device_id uuid   not null references telemetry.device (id) on delete cascade,
  name      text   not null,
  attr_key  text   not null default '',
  events    bigint not null,
  failures  bigint not null default 0,
  primary key (day, device_id, name, attr_key)
);

create index if not exists event_daily_name_day_idx
  on telemetry.event_daily (name, day);

-- Latency kept as a log-scale histogram at 8 buckets per octave, so p50 and p95 survive the
-- raw rows. Summing bucket counts across days is an exact merge, which averaging per-day
-- percentiles is not. Stored as rows rather than a jsonb blob so merging is `sum(n) group by
-- bucket` and raw rows fold in under the identical bucket expression -- which is what makes
-- the read path oblivious to where the raw/rollup seam falls.
create table if not exists telemetry.event_duration_daily (
  day       date     not null,
  device_id uuid     not null references telemetry.device (id) on delete cascade,
  name      text     not null,
  bucket    smallint not null,
  n         bigint   not null,
  primary key (day, device_id, name, bucket)
);

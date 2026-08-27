create schema if not exists telemetry;

create table if not exists telemetry.session (
  session_id   text        primary key,
  device       text        not null,
  started_at   timestamptz not null,
  last_seen_at timestamptz not null,
  attrs        jsonb       not null default '{}'::jsonb
);

create index if not exists session_device_started_idx
  on telemetry.session (device, started_at desc);

create table if not exists telemetry.metric_point (
  dedupe_key uuid             primary key,
  ts         timestamptz      not null,
  device     text             not null,
  session_id text,
  metric     text             not null,
  model      text,
  value      double precision not null,
  attrs      jsonb            not null default '{}'::jsonb
);

create index if not exists metric_point_metric_ts_idx
  on telemetry.metric_point (metric, ts desc);
create index if not exists metric_point_ts_brin_idx
  on telemetry.metric_point using brin (ts) with (pages_per_range = 32);

create table if not exists telemetry.event (
  dedupe_key  uuid        primary key,
  ts          timestamptz not null,
  device      text        not null,
  session_id  text,
  name        text        not null,
  model       text,
  duration_ms integer,
  attrs       jsonb       not null default '{}'::jsonb
);

create index if not exists event_name_ts_idx
  on telemetry.event (name, ts desc);
create index if not exists event_ts_brin_idx
  on telemetry.event using brin (ts) with (pages_per_range = 32);
create index if not exists event_attrs_gin_idx
  on telemetry.event using gin (attrs jsonb_path_ops);

create table if not exists telemetry.device (
  device          text        primary key,
  first_seen      timestamptz not null,
  acknowledged_at timestamptz
);

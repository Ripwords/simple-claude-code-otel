# Design A. Normalized, column-promoted storage and query layer

Ground truth is `docs/telemetry-schema.md`. Everything below assumes it.

Three facts from that file drive the whole design.

1. All six metrics are DELTA monotonic sums. Ingest is pure append and every dashboard number is a `SUM` over a window. No counter-reset arithmetic exists anywhere.
2. Claude Code emits no per-machine attribute. `device.name` from `OTEL_RESOURCE_ATTRIBUTES` is the only device identity, and it lands on the resource and on every datapoint.
3. Events are an open set (plugins, MCP servers add more). Metrics are a closed set of six.

## 1. Schema

### Design stance on normalization

Two dimension tables earn their keep. `device` because it is the headline axis and needs display metadata the wire never carries (label, colour, active flag). `session` because `session.id` is a 36-byte UUID that repeats on literally every row, and because "how many sessions" must not be a `count(distinct uuid)` over the fact table.

Nothing else gets a lookup table. `model`, `tool_name`, `query_source`, `point_type`, `decision`, `language` stay as `text` columns. Their cardinality is under 20 values each. A join to save four bytes per row on a table of half a million rows is a rounding error that costs a join on every single dashboard query. Reject it.

Promoted to typed columns are exactly the dimensions the dashboard filters or groups by. Everything else stays in `attrs jsonb`, unindexed, for forensics.

Promoted: `device_id`, `session_id`, `ts`, `metric`, `value`, `model`, `query_source`, `point_type`, `start_type`, `tool_name`, `decision`, `decision_source`, `language`, `success`, `duration_ms`, `status_code`, `event_name`, `event_sequence`, token counts, `cost_usd_micros`.

Not promoted, left in `attrs`: `user.id`, `user.email`, `user.account_uuid`, `user.account_id`, `organization.id`, `terminal.type`, `os.type`, `os.version`, `host.arch`, `service.version`, `request_id`, `client_request_id`, `tool_use_id`, `prompt.id`, `message.uuid`, `tool_input_size_bytes`, `tool_result_size_bytes`, `prompt`, `response`, `speed`, `hook_*`, `num_hooks`. Single-account deployment means the user and org columns have cardinality one and would be dead weight. The identifiers are drill-down fields you reach for after you have already narrowed to one session, and a jsonb read at that point is free. `terminal.type` and `os.version` get denormalized onto `session` instead, where they belong and cost nothing.

### DDL

```sql
create extension if not exists pgcrypto;

create type metric_kind as enum (
  'cost', 'token', 'lines_of_code', 'active_time', 'session_count', 'edit_decision'
);

create table device (
  device_id     smallint generated always as identity primary key,
  name          text        not null unique,
  label         text,
  colour        text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
insert into device (name, label) values ('unknown', 'Untagged');

create table session (
  session_id      bigint generated always as identity primary key,
  session_uuid    uuid        not null unique,
  device_id       smallint    not null references device,
  started_at      timestamptz not null,
  last_seen_at    timestamptz not null,
  terminal_type   text,
  os_type         text,
  os_version      text,
  host_arch       text,
  service_version text,
  user_email      text,
  organization_id text
);
create index session_device_started_idx on session (device_id, started_at desc);
```

`metric` is an enum because the six names came off the wire and a seventh would be a Claude Code release event worth a migration. `event_name` is `text` because plugins and MCP servers add event names at runtime and an enum would force an `ALTER TYPE` on data arrival.

```sql
create table metric_point (
  ts              timestamptz not null,
  window_start    timestamptz not null,
  device_id       smallint    not null references device,
  session_id      bigint      not null references session,
  metric          metric_kind not null,
  value           double precision not null,
  model           text,
  query_source    text,
  point_type      text,
  start_type      text,
  tool_name       text,
  decision        text,
  decision_source text,
  language        text,
  attrs           jsonb       not null default '{}',
  dedupe_key      bytea       not null,
  primary key (ts, dedupe_key)
) partition by range (ts);

create index mp_metric_ts_idx on metric_point (metric, ts desc)
  include (device_id, value, model, point_type, query_source);
create index mp_device_ts_idx on metric_point (device_id, ts desc);
create index mp_session_idx   on metric_point (session_id, ts);
```

```sql
create table event (
  ts                    timestamptz not null,
  device_id             smallint    not null references device,
  session_id            bigint      not null references session,
  event_name            text        not null,
  event_sequence        bigint,
  model                 text,
  tool_name             text,
  success               boolean,
  decision              text,
  decision_source       text,
  duration_ms           integer,
  status_code           integer,
  attempt               smallint,
  error                 text,
  cost_usd_micros       bigint,
  input_tokens          integer,
  output_tokens         integer,
  cache_read_tokens     integer,
  cache_creation_tokens integer,
  attrs                 jsonb       not null default '{}',
  dedupe_key            bytea       not null,
  primary key (ts, dedupe_key)
) partition by range (ts);

create index ev_name_ts_idx on event (event_name, ts desc)
  include (device_id, tool_name, success, duration_ms, status_code);
create index ev_device_ts_idx on event (device_id, ts desc);
create index ev_tool_ts_idx   on event (tool_name, ts desc) where tool_name is not null;
create index ev_session_seq_idx on event (session_id, event_sequence);
```

`cost_usd_micros` is `bigint`, not float. The event carries exact micros and integer arithmetic makes reconciliation exact. The `cost` metric stays `double precision` because the wire sends `asDouble` and inventing precision it does not have would be a lie.

### Why each index exists

`primary key (ts, dedupe_key)` on both fact tables is the idempotency arbiter for `ON CONFLICT`. It leads with `ts` because a partitioned table requires the partition key in every unique constraint. This is safe rather than a compromise, because a retried datapoint carries a byte-identical `timeUnixNano` and therefore always lands in the same partition, so the local uniqueness is global uniqueness in practice.

`mp_metric_ts_idx` is the workhorse. Every metric query has the shape `where metric = ? and ts between ? and ?`, and the device filter is optional. Leading with `metric` then `ts` means one range scan per query, and the `INCLUDE` payload turns total cost, cost by model, tokens by type, lines of code, and active time into index-only scans that never touch the heap.

`mp_device_ts_idx` serves the device drill-down page that wants every metric for one machine.

`mp_session_idx` serves the session detail view.

`ev_name_ts_idx` mirrors the metric index. Tool volume, success rate, latency percentiles, and API error rate all filter on `event_name` first. The `INCLUDE` payload covers all four.

`ev_tool_ts_idx` is partial. Two thirds of event rows have a null `tool_name` (`api_request`, `user_prompt`, `assistant_response`, hooks), so excluding them keeps the per-tool index roughly a third the size for no loss.

`ev_session_seq_idx` orders a session's events for replay.

`attrs` gets no GIN index. Nothing on the dashboard filters on it. Adding GIN would roughly double write cost to serve queries that do not exist.

### Partitioning and retention

`metric_point` is partitioned monthly. `event` is partitioned weekly, because it has the shorter retention and weekly granularity means retention error is at most seven days rather than thirty.

Retention is enforced by `drop table`, never `delete`. A `delete` on Neon rewrites pages, bloats, and requires a vacuum you have to think about. A partition drop is a catalogue update.

- `event` partitions drop at 35 days.
- `metric_point` partitions drop at 190 days.
- Rollup tables are never dropped.

```sql
create table metric_daily (
  day          date        not null,
  device_id    smallint    not null references device,
  metric       metric_kind not null,
  model        text        not null default '',
  point_type   text        not null default '',
  query_source text        not null default '',
  value_sum    double precision not null,
  point_count  integer     not null,
  primary key (day, device_id, metric, model, point_type, query_source)
);

create table event_daily (
  day                   date     not null,
  device_id             smallint not null references device,
  event_name            text     not null,
  tool_name             text     not null default '',
  model                 text     not null default '',
  n                     integer  not null,
  n_success             integer  not null default 0,
  n_error               integer  not null default 0,
  duration_ms_sum       bigint   not null default 0,
  duration_bucket_counts integer[] not null default '{}',
  primary key (day, device_id, event_name, tool_name, model)
);
```

The rollup grouping columns are `not null default ''` because a primary key cannot contain nulls. The ingest and rollup paths both `coalesce(model, '')`. This is the one place where the promoted columns' nullability leaks into the design and it is worth the ugliness to get a real primary key that `on conflict` can target.

`duration_bucket_counts` holds counts against fixed log-spaced edges `[50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, ∞]`. Fixed edges are the only histogram shape that sums correctly across days, which is what makes latency percentiles survive the raw event drop.

Maintenance runs from one Vercel cron at 03:10 UTC hitting `/api/cron/maintain`. It creates the next two partitions for each table ahead of need, drops expired ones, and upserts the rollups for yesterday and today. Re-running the rollup for today on every pass means late-arriving data is absorbed and the job is safe to run any number of times.

```sql
insert into metric_daily (day, device_id, metric, model, point_type, query_source, value_sum, point_count)
select ts::date, device_id, metric,
       coalesce(model, ''), coalesce(point_type, ''), coalesce(query_source, ''),
       sum(value), count(*)
from metric_point
where ts >= $1::date and ts < $1::date + 1
group by 1, 2, 3, 4, 5, 6
on conflict (day, device_id, metric, model, point_type, query_source)
do update set value_sum = excluded.value_sum, point_count = excluded.point_count;
```

## 2. Idempotency

OTLP retries on 5xx and resends. There are two layers, and the second is the one that is actually correct.

### Layer one, the batch fast path

Hash the raw request body with SHA-256 into `ingest_batch`.

```sql
create table ingest_batch (
  body_sha256 bytea primary key,
  signal      text        not null,
  received_at timestamptz not null default now(),
  row_count   integer     not null
);
```

The batch row is inserted in the **same transaction** as the fact rows, and only on success. A batch row that exists therefore proves its rows are committed. If the transaction aborts, no batch row exists and the retry does full work. Splitting these into two transactions would create a window where the guard says "already done" for rows that never landed, so do not.

### Layer two, the per-datapoint natural key

The batch hash only catches byte-identical resends. If Claude Code re-batches on retry, splitting or merging exports, the body hash changes and the fast path misses. The per-row key is what makes correctness unconditional.

For a metric datapoint:

```
dedupe_key = sha256(
  metric_name        || '\x1f' ||
  session_uuid       || '\x1f' ||
  startTimeUnixNano  || '\x1f' ||   -- raw string, not the truncated timestamptz
  timeUnixNano       || '\x1f' ||   -- raw string
  canonical_attrs                    -- keys sorted, k=v joined by \x1e
)
```

For a log record:

```
dedupe_key = sha256(event_name || '\x1f' || session_uuid || '\x1f' || event_sequence || '\x1f' || timeUnixNano)
```

Both hash the **raw nanosecond strings**, not the derived `timestamptz`. Postgres timestamps are microsecond precision, so two genuinely distinct datapoints 300 nanoseconds apart would collapse to the same `ts` and the key must not.

Insert with `on conflict (ts, dedupe_key) do nothing`.

### Why this cannot drop a legitimately distinct datapoint

The proof rests on what DELTA temporality means.

A delta sum datapoint reports the increment accumulated over the half-open window `[startTimeUnixNano, timeUnixNano)` for one stream, where a stream is the tuple of metric name plus the complete attribute set. The OTEL SDK aggregates within a stream before export. Two increments in the same window with the same attribute set are, by definition of the aggregation, merged into one datapoint before it ever hits the wire. So within a single export, `(metric, attributes, window)` is unique.

Across exports, consecutive windows for a stream are disjoint and contiguous. The next export's `startTimeUnixNano` equals this one's `timeUnixNano`. Windows for a stream never repeat.

`session.id` is in the key and is unique per Claude Code process, so two concurrent processes on the same machine cannot collide even if their windows align, and a process restart produces a fresh `startTimeUnixNano` anyway.

Therefore two rows agreeing on metric, session, both window endpoints, and every attribute cannot be two distinct increments. The only way to produce that tuple twice is to send the same datapoint twice. Collision implies duplicate, which is exactly what the constraint asserts.

For logs, `event.sequence` is monotonic within a session, so `(session, sequence)` alone is already unique. `event_name` and `timeUnixNano` are in the digest as reinforcement, and adding them is one-directional. They are identical on a retry so they can never split a duplicate into two rows, and they can only ever separate records that were distinct to begin with.

### The residual risk, stated

If a future Claude Code build stopped setting `session.id` or emitted colliding sequences, the key weakens. Ingest asserts both are present and rejects the record loudly rather than writing a row it cannot dedupe.

Ingest also asserts `aggregationTemporality == 1` on every sum and responds 400 with a logged error if it is not. Silently summing cumulative datapoints would inflate every number on the dashboard by orders of magnitude without erroring, and a loud 400 is much better than a plausible wrong dashboard.

## 3. Ingest transform

Device resolution order, first non-empty wins.

1. `resourceMetrics[i].resource.attributes` entry with key `device.name`.
2. The same key on the individual datapoint or log record attributes. Claude Code copies it there, so this covers a malformed resource block.
3. The `x-device-name` request header, an escape hatch under your control for a machine you cannot set env vars on.
4. The literal `unknown`.

There is deliberately no attempt at `host.name`. The schema file measured that Claude Code does not emit it.

```
POST /api/otlp/v1/metrics
  body = await readRawBody()
  bodyHash = sha256(body)
  json = JSON.parse(body)

  BEGIN

  if exists(select 1 from ingest_batch where body_sha256 = bodyHash):
      COMMIT; return 200            // fast path

  rows = []
  for rm in json.resourceMetrics:
      resAttrs   = flattenAnyValue(rm.resource.attributes)
      resDevice  = resAttrs['device.name']

      for scope in rm.scopeMetrics:
          for metric in scope.metrics:
              kind = METRIC_KIND[metric.name]        // the closed map of six
              if kind is null: continue              // unknown metric, count and skip

              assert metric.sum.aggregationTemporality == 1   // else 400
              assert metric.sum.isMonotonic

              for dp in metric.sum.dataPoints:
                  a = flattenAnyValue(dp.attributes)

                  deviceName = resDevice ?? a['device.name'] ?? header('x-device-name') ?? 'unknown'
                  sessionUuid = a['session.id']                // reject the row if absent

                  rows.push({
                    ts:           nanoToTimestamptz(dp.timeUnixNano),
                    window_start: nanoToTimestamptz(dp.startTimeUnixNano),
                    deviceName, sessionUuid,
                    metric: kind,
                    value:  dp.asDouble ?? Number(dp.asInt),
                    model:        a['model'],
                    query_source: a['query_source'],
                    point_type:   a['type'],
                    start_type:   a['start_type'],
                    tool_name:    a['tool_name'],
                    decision:     a['decision'],
                    decision_source: a['source'],
                    language:     a['language'],
                    attrs:  omit(a, PROMOTED_KEYS ∪ {'device.name'}),
                    dedupe_key: sha256(join('\x1f', [
                      metric.name, sessionUuid,
                      dp.startTimeUnixNano, dp.timeUnixNano,   // raw strings
                      canonicalAttrs(a)
                    ]))
                  })

  // dimensions first, one statement each, not per row
  upsertDevices(distinct rows.deviceName)     // insert .. on conflict (name)
                                              //   do update set last_seen_at = greatest(...)
  upsertSessions(distinct (rows.sessionUuid, deviceId, resAttrs, a))
      // insert .. on conflict (session_uuid) do update set
      //   last_seen_at = greatest(session.last_seen_at, excluded.last_seen_at)
      // started_at is never overwritten, it is the min of what was seen

  insert into metric_point (...) select * from unnest($1::..., ...) 
    on conflict (ts, dedupe_key) do nothing

  insert into ingest_batch (body_sha256, signal, row_count) values (bodyHash, 'metrics', rows.length)

  COMMIT
  return 200
```

`/api/otlp/v1/logs` is the same shape. It walks `resourceLogs[].scopeLogs[].logRecords[]`, reads the bare name from the `event.name` attribute rather than parsing `body.stringValue`, and maps `input_tokens`, `duration_ms`, `status_code` and friends into their typed columns with a per-event-name field map.

Notes that matter.

`flattenAnyValue` collapses OTLP's `{stringValue}` / `{intValue}` / `{doubleValue}` / `{boolValue}` wrappers to primitives once, at the boundary. Nothing downstream ever sees an `AnyValue`.

`success` on `tool_result` arrives as a string `"true"` in some encodings and a real bool in others. Coerce explicitly at the boundary and never write null when the attribute was present.

Every insert is a single multi-row statement built from `unnest` arrays. A per-row round trip over `@neondatabase/serverless` would dominate the request time for a 12-row export and be absurd for a 200-row one.

Any thrown error rolls back and returns 500, which is what makes OTLP retry, which is what the whole idempotency story exists to absorb.

## 4. Query layer

Every query takes `$1 from timestamptz`, `$2 to timestamptz`, and `$3 device_id smallint[]` where null means all devices. The device filter is written as `($3::smallint[] is null or device_id = any($3))` so one prepared statement serves both the per-device and the all-devices case.

### Total cost

```sql
select d.name as device,
       sum(mp.value)::numeric(12, 4) as cost_usd
from metric_point mp
join device d using (device_id)
where mp.metric = 'cost'
  and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by d.name
order by cost_usd desc;
```

### Cost by model

```sql
select d.name as device,
       coalesce(mp.model, 'unknown') as model,
       sum(mp.value)::numeric(12, 4) as cost_usd,
       count(*) as points
from metric_point mp
join device d using (device_id)
where mp.metric = 'cost'
  and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by d.name, mp.model
order by d.name, cost_usd desc;
```

### Tokens by type

```sql
select d.name as device,
       mp.point_type as token_type,
       coalesce(mp.model, 'unknown') as model,
       sum(mp.value)::bigint as tokens
from metric_point mp
join device d using (device_id)
where mp.metric = 'token'
  and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by d.name, mp.point_type, mp.model
order by d.name, tokens desc;
```

Cache hit ratio drops straight out of the same scan.

```sql
select d.name as device,
       sum(mp.value) filter (where mp.point_type = 'cacheRead')::bigint as cache_read,
       sum(mp.value) filter (where mp.point_type = 'input')::bigint     as input,
       round(100.0 * sum(mp.value) filter (where mp.point_type = 'cacheRead')
             / nullif(sum(mp.value) filter (where mp.point_type in ('input', 'cacheRead')), 0), 1) as cache_pct
from metric_point mp join device d using (device_id)
where mp.metric = 'token' and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by d.name;
```

### Sessions

Two different questions, so two queries. The `session` table answers "how many distinct sessions existed". The `session_count` metric answers "how many session starts were recorded", which counts resumes separately via `start_type`.

```sql
select d.name as device,
       count(*) as sessions,
       min(s.started_at) as first_session,
       max(s.last_seen_at) as last_activity
from session s
join device d using (device_id)
where s.started_at >= $1 and s.started_at < $2
  and ($3::smallint[] is null or s.device_id = any($3))
group by d.name;
```

```sql
select d.name as device,
       coalesce(mp.start_type, 'unknown') as start_type,
       sum(mp.value)::bigint as starts
from metric_point mp join device d using (device_id)
where mp.metric = 'session_count' and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by d.name, mp.start_type;
```

### Lines of code added and removed

```sql
select d.name as device,
       sum(mp.value) filter (where mp.point_type = 'added')::bigint   as added,
       sum(mp.value) filter (where mp.point_type = 'removed')::bigint as removed,
       (sum(mp.value) filter (where mp.point_type = 'added')
        - sum(mp.value) filter (where mp.point_type = 'removed'))::bigint as net
from metric_point mp
join device d using (device_id)
where mp.metric = 'lines_of_code'
  and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by d.name
order by added desc;
```

### Active time

```sql
select d.name as device,
       sum(mp.value)::bigint as active_seconds,
       round((sum(mp.value) / 3600.0)::numeric, 2) as active_hours
from metric_point mp
join device d using (device_id)
where mp.metric = 'active_time'
  and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by d.name
order by active_seconds desc;
```

### Tool call volume and success rate

```sql
select d.name as device,
       e.tool_name,
       count(*) as calls,
       count(*) filter (where e.success) as succeeded,
       count(*) filter (where e.success is false) as failed,
       round(100.0 * count(*) filter (where e.success) / nullif(count(*), 0), 1) as success_pct
from event e
join device d using (device_id)
where e.event_name = 'tool_result'
  and e.ts >= $1 and e.ts < $2
  and ($3::smallint[] is null or e.device_id = any($3))
group by d.name, e.tool_name
order by calls desc;
```

### Tool latency percentiles

```sql
select d.name as device,
       e.tool_name,
       count(*) as calls,
       percentile_cont(0.50) within group (order by e.duration_ms)::int as p50_ms,
       percentile_cont(0.95) within group (order by e.duration_ms)::int as p95_ms,
       percentile_cont(0.99) within group (order by e.duration_ms)::int as p99_ms,
       max(e.duration_ms) as max_ms
from event e
join device d using (device_id)
where e.event_name = 'tool_result'
  and e.duration_ms is not null
  and e.ts >= $1 and e.ts < $2
  and ($3::smallint[] is null or e.device_id = any($3))
group by d.name, e.tool_name
having count(*) >= 5
order by p95_ms desc;
```

The `having count(*) >= 5` is not cosmetic. A p99 over three samples is noise dressed as a statistic, and the dashboard should not print it.

### API error rate

```sql
with counted as (
  select e.device_id,
         count(*) filter (where e.event_name = 'api_request') as requests,
         count(*) filter (where e.event_name = 'api_error')   as errors
  from event e
  where e.event_name in ('api_request', 'api_error')
    and e.ts >= $1 and e.ts < $2
    and ($3::smallint[] is null or e.device_id = any($3))
  group by e.device_id
)
select d.name as device,
       c.requests,
       c.errors,
       round(100.0 * c.errors / nullif(c.requests + c.errors, 0), 2) as error_pct
from counted c
join device d using (device_id)
order by error_pct desc;
```

Broken down by status code for the drill-down.

```sql
select d.name as device,
       coalesce(e.status_code::text, 'none') as status_code,
       coalesce(e.error, 'unknown') as error,
       count(*) as n,
       max(e.attempt) as max_attempt
from event e join device d using (device_id)
where e.event_name = 'api_error' and e.ts >= $1 and e.ts < $2
  and ($3::smallint[] is null or e.device_id = any($3))
group by d.name, e.status_code, e.error
order by n desc;
```

### Work versus personal, side by side

One query, one row per device, every headline number plus the normalized ratios that make the comparison mean something.

```sql
with m as (
  select device_id,
         sum(value) filter (where metric = 'cost')                                    as cost_usd,
         sum(value) filter (where metric = 'active_time')                             as active_s,
         sum(value) filter (where metric = 'token' and point_type = 'input')          as input_tok,
         sum(value) filter (where metric = 'token' and point_type = 'output')         as output_tok,
         sum(value) filter (where metric = 'token' and point_type = 'cacheRead')      as cache_read_tok,
         sum(value) filter (where metric = 'token' and point_type = 'cacheCreation')  as cache_create_tok,
         sum(value) filter (where metric = 'lines_of_code' and point_type = 'added')  as loc_added,
         sum(value) filter (where metric = 'lines_of_code' and point_type = 'removed') as loc_removed
  from metric_point
  where ts >= $1 and ts < $2
  group by device_id
), e as (
  select device_id,
         count(*) filter (where event_name = 'tool_result')                   as tool_calls,
         count(*) filter (where event_name = 'tool_result' and success)       as tool_ok,
         count(*) filter (where event_name = 'api_request')                   as api_requests,
         count(*) filter (where event_name = 'api_error')                     as api_errors,
         percentile_cont(0.95) within group (order by duration_ms)
           filter (where event_name = 'tool_result')                          as tool_p95_ms
  from event
  where ts >= $1 and ts < $2
  group by device_id
), s as (
  select device_id, count(*) as sessions
  from session
  where started_at >= $1 and started_at < $2
  group by device_id
)
select d.name  as device,
       d.label,
       coalesce(s.sessions, 0)                                as sessions,
       round(coalesce(m.cost_usd, 0)::numeric, 2)             as cost_usd,
       round((coalesce(m.active_s, 0) / 3600.0)::numeric, 2)  as active_hours,
       coalesce(m.input_tok, 0)::bigint                       as input_tokens,
       coalesce(m.output_tok, 0)::bigint                      as output_tokens,
       coalesce(m.cache_read_tok, 0)::bigint                  as cache_read_tokens,
       coalesce(m.cache_create_tok, 0)::bigint                as cache_creation_tokens,
       coalesce(m.loc_added, 0)::bigint                       as loc_added,
       coalesce(m.loc_removed, 0)::bigint                     as loc_removed,
       coalesce(e.tool_calls, 0)                              as tool_calls,
       round(100.0 * e.tool_ok / nullif(e.tool_calls, 0), 1)  as tool_success_pct,
       e.tool_p95_ms::int                                     as tool_p95_ms,
       round(100.0 * e.api_errors
             / nullif(e.api_requests + e.api_errors, 0), 2)   as api_error_pct,
       -- normalized, the numbers that actually compare two machines
       round((m.cost_usd / nullif(m.active_s / 3600.0, 0))::numeric, 2)   as cost_per_active_hour,
       round((m.cost_usd / nullif(s.sessions, 0))::numeric, 3)            as cost_per_session,
       round((m.loc_added / nullif(m.active_s / 3600.0, 0))::numeric, 1)  as loc_added_per_hour,
       round((e.tool_calls / nullif(s.sessions, 0)::numeric), 1)          as tool_calls_per_session
from device d
left join m using (device_id)
left join e using (device_id)
left join s using (device_id)
where d.name <> 'unknown' or m.device_id is not null
order by d.name;
```

Raw totals answer "which machine did more". The ratios answer "which machine works differently", which is the question actually being asked.

### Time series for the charts

One shape serves every chart. `$4` is the bucket width in seconds.

```sql
select to_timestamp(floor(extract(epoch from mp.ts) / $4) * $4) as bucket,
       d.name as device,
       sum(mp.value) as value
from metric_point mp
join device d using (device_id)
where mp.metric = $5::metric_kind
  and mp.ts >= $1 and mp.ts < $2
  and ($3::smallint[] is null or mp.device_id = any($3))
group by bucket, d.name
order by bucket;
```

Delta temporality is what makes this trivially correct. Each bucket is a plain sum of increments with no rate calculation, no reset handling, and no window functions.

### Queries past the raw retention horizon

Anything older than the raw window reads `metric_daily` and `event_daily` with the identical shape, swapping `sum(value)` for `sum(value_sum)` and `ts` for `day`. The API layer picks the source from the requested range and says which one it used in the response, so a chart is never silently half raw and half approximated.

## 5. Cardinality and volume, one developer on two machines

Assume six active hours a day on the work laptop and two on the personal, and the default 60-second metric export interval.

Distinct dimension values.

| Dimension | Distinct values |
|---|---|
| `device` | 2, plus `unknown` |
| `model` | 3 to 4 |
| `query_source` | 3 to 4 |
| `point_type` | 4 for tokens, 2 for lines of code, 1 to 2 for active time |
| `start_type` | 2 to 3 |
| `tool_name` | 15 to 25 including MCP tools |
| `event_name` | 12 |
| `session` | 8 to 15 per day, roughly 4,000 per year |

Live metric streams per active export, counting only streams with movement in the window.

| Metric | Streams | Note |
|---|---|---|
| `token.usage` | ~8 | model × query_source × 4 types |
| `cost.usage` | ~2 | model × query_source |
| `active_time.total` | 1 | |
| `lines_of_code.count` | ~2 | sparse, only on edits |
| `code_edit_tool.decision` | ~1 | sparse |
| `session.count` | ~0 | only at session start |

Call it 12 datapoints per export while active, and fewer than 3 while idle.

Metric rows. 8 combined active hours give 480 exports and about 5,800 rows a day. Round to 6,000. That is 180,000 a month and 1.1 million over the 190-day raw window. At roughly 130 bytes of tuple plus about 120 bytes across the three indexes, `metric_point` steady state is near **270 MB**.

Event rows on a heavy day, per developer across both machines.

| Event | Per day |
|---|---|
| `tool_result` | 1,500 |
| `api_request` | 700 |
| `assistant_response` | 700 |
| `tool_decision` | 400 |
| `user_prompt` | 300 |
| hooks | 800 |
| `api_error` | 20 |
| other | 50 |

About 4,500 a day, 135,000 a month. With redaction on, `attrs` averages roughly 350 bytes, so a row plus indexes is near 600 bytes. The 35-day window holds about 158,000 rows, so `event` steady state is near **95 MB**.

Rollups grow at roughly 60 `metric_daily` rows and 50 `event_daily` rows a day, so under **20 MB per year** and they never get dropped.

**Steady state is under 400 MB and it is flat.** It sits inside the Neon free tier with room to spare, and the interesting number is that it stops growing rather than that it is small.

Write load is one POST a minute per active machine carrying a dozen rows, plus a log export on the same cadence. Peak is a handful of rows per second. Read load is a single user hitting a dashboard. Neither is remotely near a bottleneck, which is why the design spends its complexity budget on correctness and retention rather than on throughput.

## 6. The three biggest weaknesses of this design

**The `metric_point` union table cannot express which columns belong to which metric.** A `cost` row must have a `model` and must never have a `tool_name`. A `session_count` row is the reverse. The schema says nothing about this. Every one of the eight dimension columns is nullable, so a buggy ingest that writes `point_type` into `start_type` produces rows Postgres accepts happily and queries silently miss. The honest fix is either six per-metric tables with exactly the right columns each, or a fat `check` constraint per metric value, and I took neither. I took the union because it gives one ingest path, one index set, and one query shape, and because six near-identical tables is a lot of duplication for a project this size. It is a real trade and this is the weakest seam in the design. If it starts biting, the mitigation to reach for first is a per-metric `check` constraint, not a rewrite.

**Device identity is self-asserted and unverifiable.** `device.name` is an environment variable on the client. Nothing in the pipeline can tell a genuine second machine from a typo. Set `device.name=work-mac` on Monday and `device.name=work-macbook` on Tuesday and the dashboard grows a third device with the history split across two rows, with no signal that anything went wrong. The `unknown` fallback silently absorbs a machine where the variable was forgotten and mixes it with any other such machine. Worse, anyone holding the bearer token can write any `device.name` they like, including one that already exists. The design mitigates none of this, it only contains it. Because `device` is a real table with a surrogate key, merging two devices is an `update ... set device_id` across two fact tables plus a delete, which is a maintenance script rather than a data-loss event. That is the entire defence and it is a repair path, not a prevention.

**Latency percentiles do not survive the retention horizon.** Raw events drop at 35 days and `event_daily` keeps only fixed-edge bucket counts, so any percentile older than 35 days is a linear interpolation inside a bucket. With edges at 10s and 30s, a p99 that truly sits at 12s and one that sits at 28s are indistinguishable after the drop. The tail, which is the part of a latency distribution anyone actually cares about, is exactly the part the buckets resolve worst. The design compensates by having the API label which source answered a query, so the chart can grey out approximated regions, but that is disclosure and not accuracy. A t-digest or a `ddsketch` column would roll up correctly and I chose not to carry the dependency for a two-machine dashboard. If year-over-year p99 ever becomes a real question, that is the change to make, and it is a migration rather than an adjustment.

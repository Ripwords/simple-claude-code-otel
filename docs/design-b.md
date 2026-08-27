# Design B: storage and query layer

Minimalist variant. Two tables, one of them tiny. Every Claude Code signal, metric
datapoint or log record, lands in one fact table. Attributes stay in `jsonb`.

Ground truth is `docs/telemetry-schema.md`. Everything below assumes it: DELTA
temporality on all six metrics, `device.name` from `OTEL_RESOURCE_ATTRIBUTES`,
`session.id` on every datapoint and log record.

## 0. The bet

Claude Code shipped six metrics and eleven event types in `2.1.247`. It will ship
more. A relational column per attribute means a migration every time Anthropic adds
`speed` to another event or introduces `claude_code.subagent.count`. A `jsonb`
attribute bag means the ingest path never rejects a field it has not seen, and a new
dashboard panel is a new `SELECT`, not a `SELECT` plus an `ALTER TABLE` plus a
backfill for the rows that predate the column.

The cost is real and I am not hiding it. OTLP JSON encodes int64 as a JSON *string*,
so `duration_ms`, `input_tokens`, and `status_code` are text inside `attrs`. Every
percentile query casts per row. The planner has no statistics on `attrs->>'x'`
without an expression index, so row estimates for jsonb predicates are guesses.

Where the bet is worth it: cost, tokens, lines of code, active time, sessions. These
are `SUM` over a name-and-time range grouped by two or three low-cardinality
attributes. The cast is on the group key, not in a join predicate, and the range scan
is the selective step. jsonb costs nothing measurable here.

Where it is not worth it: tool latency percentiles. `percentile_cont` over
`(attrs->>'duration_ms')::double precision` sorts every row in the group and no index
can help. If that panel gets slow, the honest fix is a typed rollup table, not
another index. I did not build one now because at the volume in section 5 it does not
need one.

## 1. DDL

```sql
-- Per-session constants, extracted once instead of repeated on every fact row.
-- user.id, user.email, user.account_uuid, user.account_id, organization.id,
-- terminal.type, service.version, os.type, os.version, host.arch are all constant
-- for the life of a session. Storing them inline would roughly double fact row width.
create table session (
  session_id   text        primary key,
  device       text        not null,
  started_at   timestamptz not null,
  last_seen_at timestamptz not null,
  attrs        jsonb       not null default '{}'::jsonb
);

create index session_device_started_idx on session (device, started_at desc);

-- The fact table. One row per metric datapoint and per log record.
-- value is not null for metric datapoints, null for events. That is the discriminator;
-- no `kind` column is needed.
create table signal (
  dedupe_key  uuid             primary key,
  ts          timestamptz      not null,
  device      text             not null,
  name        text             not null,
  value       double precision,
  session_id  text,
  attrs       jsonb            not null default '{}'::jsonb,
  ingested_at timestamptz      not null default now()
);
```

Eight columns, seven of them load-bearing on every query. `ingested_at` is the eighth
and exists only to answer "did my laptop actually deliver last night", which is the
first question asked when a panel goes flat.

`name` holds the fully prefixed name for both signal kinds: `claude_code.cost.usage`
for metrics, `claude_code.tool_result` for events. The log record's
`body.stringValue` already carries the prefixed form, so no synthetic namespacing is
needed and the two name spaces cannot collide.

`device` is denormalized onto `signal` even though it is derivable through
`session_id`. Group-by-device is the headline requirement of this dashboard. It is
the one dimension that must never cost a join.

There is deliberately **no foreign key** from `signal.session_id` to
`session.session_id`. A fact row must never be rejected because its dimension row is
missing or arrived out of order. Log records that predate session establishment carry
a null `session_id` and still land.

### Indexes

```sql
-- 1. Dedupe. Required for ON CONFLICT. uuid is 16 bytes flat, half the width of a
--    full sha256 bytea, and 128 bits of a sha256 digest has a birthday collision
--    probability around 1e-25 at 1e7 rows.
--    (created implicitly by `primary key`)

-- 2. The only index the dashboard's hot path uses. Every query in section 4 is
--    "one metric name, one time range, group by device". name is the equality
--    predicate, ts is the range. device is read from the heap because most panels
--    want all devices at once anyway.
create index signal_name_ts_idx on signal (name, ts desc);

-- 3. Retention deletes and any unfiltered full-range scan. Inserts arrive in ts
--    order, so BRIN correlation is near perfect and this index is kilobytes, not
--    megabytes. It is the cheapest index in the schema by two orders of magnitude.
create index signal_ts_brin_idx on signal using brin (ts) with (pages_per_range = 32);

-- 4. Ad-hoc attribute filtering: "only Bash calls", "only opus", "only 429s", plus
--    every future metric whose attributes this design does not yet know about.
--    jsonb_path_ops is ~3x smaller than the default opclass and supports @>, which
--    is the only operator these filters need.
--
--    The subtraction is the important part. tool_use_id, request_id,
--    client_request_id, prompt.id, and message.uuid are unique per row. Indexing
--    them adds roughly one GIN entry per row per key (about 13M dead entries a year)
--    and nothing ever filters on them by equality. Measured over 200k representative
--    rows: 4056 kB with the subtraction, 15 MB without it, 24 MB with the default
--    opclass. The subtraction is a 74% saving, the opclass choice another 40%.
create index signal_attrs_gin_idx on signal using gin (
  (attrs - '{tool_use_id,request_id,client_request_id,prompt.id,message.uuid}'::text[])
  jsonb_path_ops
);
```

Four indexes. **No per-attribute expression indexes.** That is a deliberate finding,
not an omission. Every query in section 4 is a grouped aggregate over a
`(name, ts)` range scan; the jsonb access happens on rows already fetched, where an
index cannot help. `percentile_cont` sorts regardless of indexing. `group by
attrs->>'model'` does not benefit from an index on `attrs->>'model'`.

The rule for adding one later: create an expression index only when a jsonb key
appears as an **equality filter** in a query whose `(name, ts)` range still returns
more than ~50k rows. Today none do.

A query using the GIN index must repeat the subtraction expression verbatim, which is
ugly:

```sql
where (attrs - '{tool_use_id,request_id,client_request_id,prompt.id,message.uuid}'::text[])
      @> '{"tool_name":"Bash"}'::jsonb
```

Wrap it in a SQL function marked `immutable` if the query layer grows more than three
call sites. It is worth the ugliness at the volume in section 5.

### Retention

Per-name retention, expressed as data rather than a chain of `WHERE` clauses. One
statement, one policy table's worth of literals, driven daily by a Vercel cron hitting
`/api/cron/retention`.

```sql
-- Short-lived, high-volume, low-analytic-value.
delete from signal s
using (values
  ('claude_code.hook_execution_start',    30),
  ('claude_code.hook_execution_complete', 30),
  ('claude_code.hook_registered',         30),
  ('claude_code.assistant_response',      90),
  ('claude_code.user_prompt',             90)
) as r(name, days)
where s.name = r.name
  and s.ts < now() - make_interval(days => r.days);

-- Everything else. 400 days so a year-over-year comparison always has both sides.
delete from signal
where ts < now() - interval '400 days'
  and name not in (
    'claude_code.hook_execution_start', 'claude_code.hook_execution_complete',
    'claude_code.hook_registered', 'claude_code.assistant_response',
    'claude_code.user_prompt'
  );

delete from session
where last_seen_at < now() - interval '400 days';
```

Both deletes drive off the BRIN index. Follow with `vacuum (analyze) signal`. Neon
autovacuum will get there, but a bulk delete once a day is exactly the case where you
want it now rather than eventually.

No table partitioning. At 3.3M rows a year (section 5) a monthly-partitioned table
buys a cheaper `DROP PARTITION` in exchange for a scheduled job that must create next
month's partition before the first datapoint of the month arrives, and that job
failing silently loses data. Bad trade at this volume. Revisit above roughly 50M rows.

## 2. Idempotency

OTLP exporters retry the whole request body on 5xx and on transport failure. The same
bytes arrive again. The strategy is a content-derived primary key plus
`ON CONFLICT DO NOTHING`, which makes ingest converge to the same end state no matter
how many times a batch is replayed or where a previous run crashed.

`dedupe_key = uuid_from(first 16 bytes of sha256(identity_string))`, computed in the
ingest handler with `node:crypto`, never in Postgres.

### Metric datapoints

```
identity = name         ‖ 0x1F ‖
           startTimeUnixNano ‖ 0x1F ‖
           timeUnixNano      ‖ 0x1F ‖
           canonical_json(datapoint.attributes)
```

`canonical_json` sorts keys lexicographically and serializes scalars in the exact form
OTLP delivered them (int64 stays the string it arrived as). The nanosecond fields are
used as the raw decimal strings off the wire, never as a converted timestamp, so
millisecond rounding in the `ts` column cannot merge two datapoints.

`value` is deliberately **excluded**. Identity determines value. A retry carries the
same value, so including it would change nothing for the retry case, while excluding
it means a hypothetical exporter bug that sends the same series-instant twice with
different values is rejected loudly rather than double-counted quietly.

**Why this cannot drop a legitimately distinct datapoint.** Two datapoints are
distinct if they differ in metric, in attribute set, or in time window. All three are
in the key. Under DELTA temporality every export sets `startTimeUnixNano` to the
previous export's end and `timeUnixNano` to now, so consecutive exports of the same
series never share the pair. Within a single export, the OTel SDK's delta aggregator
keys its internal map on the attribute set, so it cannot emit the same
`(metric, attributes)` twice in one `dataPoints` array. The aggregation happens
before serialization.

The single theoretical loss is an SDK that violates that invariant and emits two
datapoints with identical name, identical window, and identical attributes. Those two
rows would collapse into one and the second delta would be lost. That requires a bug
in the exporter, and if it happened, the correct summed answer is unrecoverable from
the wire format anyway.

### Log records

```
identity = 'log' ‖ 0x1F ‖
           session_id (or device when null)   ‖ 0x1F ‖
           attrs['event.name']                ‖ 0x1F ‖
           attrs['event.sequence']            ‖ 0x1F ‖
           attrs['event.timestamp']
```

The schema guarantees `event.name`, `event.timestamp`, and `event.sequence` on every
record. `event.sequence` is monotonic within a session, so `(session, sequence)` alone
is very likely unique; `event.name` and `event.timestamp` are included because I do
not have wire evidence of whether the sequence counter is global or per-event-type,
and **widening the key is the safe direction**. A key that is too wide splits a
duplicate into two rows, which is visible and fixable. A key that is too narrow merges
two distinct records, which is silent data loss. When in doubt, widen.

Two genuinely distinct records always differ here. Two `tool_result` events in one
session have different `event.sequence` and different `event.timestamp`. Two records
from different machines running concurrently have different `session.id`.

### The write

One statement, one implicit transaction, all-or-nothing.

```sql
insert into signal (dedupe_key, ts, device, name, value, session_id, attrs)
select (r->>'k')::uuid,
       (r->>'ts')::timestamptz,
       r->>'device',
       r->>'name',
       (r->>'value')::double precision,
       r->>'session_id',
       coalesce(r->'attrs', '{}'::jsonb)
from jsonb_array_elements($1::jsonb) as r
on conflict (dedupe_key) do nothing;
```

A single `jsonb` parameter, not one parameter per column per row. This sidesteps the
65535-parameter limit of the extended protocol entirely, so no batch chunking logic
exists and there is no batch size at which ingest starts failing.

Session upsert runs first, in the same request, also idempotent:

```sql
insert into session (session_id, device, started_at, last_seen_at, attrs)
select r->>'session_id', r->>'device',
       (r->>'first_ts')::timestamptz, (r->>'last_ts')::timestamptz,
       coalesce(r->'attrs', '{}'::jsonb)
from jsonb_array_elements($1::jsonb) as r
on conflict (session_id) do update set
  started_at   = least(session.started_at, excluded.started_at),
  last_seen_at = greatest(session.last_seen_at, excluded.last_seen_at),
  attrs        = session.attrs || excluded.attrs;
```

`least`/`greatest` make replay converge. Object-merge on `attrs` makes a later batch
carrying a new identity field additive rather than destructive.

**Gotcha that will bite whoever implements this:** `ON CONFLICT DO UPDATE` raises
`cannot affect row a second time` if the source rows contain the same
`session_id` twice. One OTLP batch always contains many records for one session, so
the handler **must** fold the batch to one row per `session_id` in JS before building
the parameter. `ON CONFLICT DO NOTHING` on `signal` has no such restriction; duplicate
`dedupe_key` values inside one batch are silently fine.

Return `204` after the transaction commits. Return `503` on any DB error so the
exporter retries the whole body, which is safe by construction. Never return `2xx` on
a failed write. A swallowed error is a permanent hole, since the exporter drops the
batch on success.

## 3. Ingest transform

`device.name` is read from the **resource**, per the schema file. The per-datapoint
copy is a fallback only.

```
normalizeDevice(raw):
  if raw is empty -> return null
  return lower(trim(raw))            # 'Work-Mac' and 'work-mac' must not split

resolveDevice(resource, pointAttrs, headers):
  1. resource.attributes['device.name']       # documented, primary
  2. pointAttrs['device.name']                # Claude Code copies it; belt and braces
  3. headers['x-device-name']                 # escape hatch for a machine whose env
                                              # you cannot edit (CI, remote container)
  4. 'unknown:' + (resource['os.type']    ?? '?') + '/'
              +  (resource['os.version'] ?? '?') + '/'
              +  (resource['host.arch']  ?? '?')
  each candidate passed through normalizeDevice; first non-null wins

  # Step 4 never merges two machines that differ in OS version or arch, and it is
  # visibly broken in the UI, which is the point: it makes a missing
  # OTEL_RESOURCE_ATTRIBUTES obvious instead of silently pooling both laptops.

flattenAttrs(otlpAttributes):
  # OTLP: [{key, value:{stringValue|intValue|doubleValue|boolValue|arrayValue|...}}]
  # int64 arrives as a JSON STRING. Preserve it verbatim; do not coerce to number,
  # or the dedupe hash stops matching the wire form and precision is lost above 2^53.
  out = {}
  for a in otlpAttributes:
    out[a.key] = first present of
      stringValue, intValue, doubleValue, boolValue,
      arrayValue.values mapped the same way
  return out

nanosToTimestamptz(nanoString):
  return new Date(Number(BigInt(nanoString) / 1000000n)).toISOString()
  # ms precision in the ts column. The dedupe key uses the raw nano string, so this
  # rounding can never collapse two datapoints.

SESSION_KEYS = { user.id, user.email, user.account_uuid, user.account_id,
                 organization.id, terminal.type }
RESOURCE_KEYS = { service.name, service.version, os.type, os.version, host.arch,
                  device.name }

split(attrs, resourceAttrs):
  sessionAttrs = pick(attrs, SESSION_KEYS) merged with pick(resourceAttrs, RESOURCE_KEYS)
  factAttrs    = omit(attrs, SESSION_KEYS ∪ RESOURCE_KEYS ∪ {session.id})
  return (sessionAttrs, factAttrs)
```

### Metrics body

```
ingestMetrics(body, headers):
  facts = [], sessions = Map()
  for rm in body.resourceMetrics:
    rattrs = flattenAttrs(rm.resource.attributes)
    for sm in rm.scopeMetrics:
      for metric in sm.metrics:
        points = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? []
        # sum is what all six current metrics use; gauge is here so a future
        # gauge-shaped metric lands instead of being dropped on the floor
        for dp in points:
          pattrs   = flattenAttrs(dp.attributes)
          device   = resolveDevice(rattrs, pattrs, headers)
          sid      = pattrs['session.id'] ?? null
          ts       = nanosToTimestamptz(dp.timeUnixNano)
          (sAttrs, fAttrs) = split(pattrs, rattrs)

          facts.push({
            k: dedupeUuid('metric', metric.name,
                          dp.startTimeUnixNano, dp.timeUnixNano,
                          canonicalJson(pattrs)),
            ts, device, name: metric.name,
            value: dp.asDouble ?? Number(dp.asInt),
            session_id: sid, attrs: fAttrs
          })
          if sid: foldSession(sessions, sid, device, ts, sAttrs)

  await tx: upsertSessions(sessions.values()); insertSignals(facts)
  return 204
```

### Logs body

```
ingestLogs(body, headers):
  facts = [], sessions = Map()
  for rl in body.resourceLogs:
    rattrs = flattenAttrs(rl.resource.attributes)
    for sl in rl.scopeLogs:
      for rec in sl.logRecords:
        lattrs = flattenAttrs(rec.attributes)
        device = resolveDevice(rattrs, lattrs, headers)
        sid    = lattrs['session.id'] ?? null
        ts     = nanosToTimestamptz(rec.timeUnixNano ?? rec.observedTimeUnixNano)

        # body.stringValue is the prefixed name ('claude_code.api_request').
        # event.name is the bare name ('api_request'). Store the prefixed form so
        # metric and event names share one disjoint namespace in signal.name.
        name = rec.body?.stringValue
               ?? ('claude_code.' + (lattrs['event.name'] ?? 'unknown'))

        (sAttrs, fAttrs) = split(lattrs, rattrs)
        # event.name is redundant with `name`; event.timestamp and event.sequence
        # are kept because they are the dedupe identity and worth being able to audit.
        delete fAttrs['event.name']

        facts.push({
          k: dedupeUuid('log', sid ?? device,
                        lattrs['event.name'],
                        lattrs['event.sequence'],
                        lattrs['event.timestamp']),
          ts, device, name, value: null, session_id: sid, attrs: fAttrs
        })
        if sid: foldSession(sessions, sid, device, ts, sAttrs)

  await tx: upsertSessions(sessions.values()); insertSignals(facts)
  return 204
```

`foldSession` keeps `min(ts)`, `max(ts)`, and a shallow attribute merge per
`session_id`, which is what makes the single-statement upsert legal.

Neon's pooled `DATABASE_URL` is a transaction-mode pooler: session state does not
survive between statements, so the handler must not rely on `SET`, on session-level
temp tables, or on server-side prepared statements persisting. Everything above is a
single self-contained statement, which is why this constraint costs nothing here. Use
`DATABASE_URL_UNPOOLED` only for the retention cron's `vacuum`.

Auth on both routes: constant-time compare of the `authorization` header against a
server-side token, since the schema confirms `OTEL_EXPORTER_OTLP_HEADERS` arrives
verbatim. Reject with `401` before parsing the body. A `401` is not retried, which is
what you want for a misconfigured client.

## 4. Query layer

Every query takes `$1 = range start`, `$2 = range end`, both `timestamptz`. Every one
groups by `device`. Add `and device = $3` to scope to a single machine.

Because temporality is DELTA, all six metrics are plain `SUM` over the window. There
is no counter-reset arithmetic anywhere.

### Total cost

```sql
select device, sum(value) as usd
from signal
where name = 'claude_code.cost.usage'
  and ts >= $1 and ts < $2
group by device
order by usd desc;
```

### Cost by model

```sql
select device,
       attrs->>'model'        as model,
       attrs->>'query_source' as query_source,
       sum(value)             as usd
from signal
where name = 'claude_code.cost.usage'
  and ts >= $1 and ts < $2
group by device, 2, 3
order by usd desc;
```

### Tokens by type

```sql
select device,
       attrs->>'model' as model,
       sum(value) filter (where attrs->>'type' = 'input')         as input,
       sum(value) filter (where attrs->>'type' = 'output')        as output,
       sum(value) filter (where attrs->>'type' = 'cacheRead')     as cache_read,
       sum(value) filter (where attrs->>'type' = 'cacheCreation') as cache_creation,
       sum(value)                                                 as total
from signal
where name = 'claude_code.token.usage'
  and ts >= $1 and ts < $2
group by device, 2
order by total desc;
```

### Sessions

Authoritative count comes from the `session` dimension, not from summing
`claude_code.session.count`, because the dimension cannot double-count a session that
spans two exports.

```sql
select device,
       count(*) filter (where started_at >= $1) as started_in_range,
       count(*)                                 as active_in_range,
       round(avg(extract(epoch from last_seen_at - started_at)) / 60.0, 1)
                                                as avg_wall_minutes
from session
where last_seen_at >= $1 and started_at < $2
group by device
order by active_in_range desc;
```

Cross-check against the metric, which additionally carries `start_type`:

```sql
select device, attrs->>'start_type' as start_type, sum(value) as sessions
from signal
where name = 'claude_code.session.count' and ts >= $1 and ts < $2
group by device, 2;
```

### Lines of code added and removed

```sql
select device,
       coalesce(sum(value) filter (where attrs->>'type' = 'added'),   0) as added,
       coalesce(sum(value) filter (where attrs->>'type' = 'removed'), 0) as removed,
       coalesce(sum(value) filter (where attrs->>'type' = 'added'),   0)
     - coalesce(sum(value) filter (where attrs->>'type' = 'removed'), 0) as net
from signal
where name = 'claude_code.lines_of_code.count'
  and ts >= $1 and ts < $2
group by device
order by added desc;
```

### Active time

```sql
select device,
       sum(value)                          as seconds,
       round((sum(value) / 3600.0)::numeric, 2) as hours
from signal
where name = 'claude_code.active_time.total'
  and ts >= $1 and ts < $2
group by device
order by seconds desc;
```

### Tool call volume and success rate

`success` may arrive as an OTLP `boolValue` (jsonb `true`) or a `stringValue`
(jsonb `"true"`). `attrs->>'success'` renders both as the text `true`, so this
comparison is correct either way.

```sql
select device,
       attrs->>'tool_name' as tool,
       count(*)                                              as calls,
       count(*) filter (where attrs->>'success' = 'true')     as succeeded,
       round(100.0 * count(*) filter (where attrs->>'success' = 'true')
             / nullif(count(*), 0), 1)                        as success_pct
from signal
where name = 'claude_code.tool_result'
  and ts >= $1 and ts < $2
group by device, 2
order by calls desc;
```

Drop the `attrs->>'tool_name'` group key for the single overall rate per device.

### Tool latency percentiles

```sql
select device,
       attrs->>'tool_name' as tool,
       count(*)            as calls,
       round(percentile_cont(0.50) within group (
         order by (attrs->>'duration_ms')::double precision)::numeric, 0) as p50_ms,
       round(percentile_cont(0.95) within group (
         order by (attrs->>'duration_ms')::double precision)::numeric, 0) as p95_ms,
       round(percentile_cont(0.99) within group (
         order by (attrs->>'duration_ms')::double precision)::numeric, 0) as p99_ms
from signal
where name = 'claude_code.tool_result'
  and ts >= $1 and ts < $2
  and attrs ? 'duration_ms'
group by device, 2
having count(*) >= 5
order by p95_ms desc;
```

`having count(*) >= 5` because a p99 over three samples is noise dressed as a number.
The same shape over `name = 'claude_code.api_request'` gives API latency.

### API error rate

`api_error` carries `attempt`, so a request retried three times emits three error
records but only one eventual `api_request`. Counting only `attempt = 1` errors gives
"requests that hit at least one error", which is the number a human wants. The raw
count is kept alongside so the retry amplification is visible rather than hidden.

```sql
with w as (
  select device, name,
         coalesce(attrs->>'attempt', '1') as attempt,
         attrs->>'status_code'            as status_code,
         attrs->>'model'                  as model
  from signal
  where name in ('claude_code.api_request', 'claude_code.api_error')
    and ts >= $1 and ts < $2
)
select device,
       count(*) filter (where name = 'claude_code.api_request')  as requests,
       count(*) filter (where name = 'claude_code.api_error'
                          and attempt = '1')                     as failed_requests,
       count(*) filter (where name = 'claude_code.api_error')     as error_records,
       round(100.0 * count(*) filter (where name = 'claude_code.api_error'
                                        and attempt = '1')
             / nullif(count(*) filter (where name = 'claude_code.api_request'), 0), 2)
                                                                  as error_pct
from w
group by device
order by error_pct desc nulls last;
```

Breakdown by status code for the drilldown:

```sql
select device, attrs->>'status_code' as status_code,
       attrs->>'model' as model, count(*) as errors
from signal
where name = 'claude_code.api_error' and ts >= $1 and ts < $2
group by device, 2, 3
order by errors desc;
```

### Work vs personal, side by side

One round trip. `$3` and `$4` are the two device names.

```sql
with m as (
  select device, 'cost_usd' as metric, sum(value) as v
    from signal where name = 'claude_code.cost.usage'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'tokens_total', sum(value)
    from signal where name = 'claude_code.token.usage'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'tokens_cache_read', sum(value)
    from signal where name = 'claude_code.token.usage'
      and attrs->>'type' = 'cacheRead'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'active_hours', sum(value) / 3600.0
    from signal where name = 'claude_code.active_time.total'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'lines_added', sum(value)
    from signal where name = 'claude_code.lines_of_code.count'
      and attrs->>'type' = 'added'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'lines_removed', sum(value)
    from signal where name = 'claude_code.lines_of_code.count'
      and attrs->>'type' = 'removed'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'tool_calls', count(*)::double precision
    from signal where name = 'claude_code.tool_result'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'tool_failures', count(*)::double precision
    from signal where name = 'claude_code.tool_result'
      and attrs->>'success' is distinct from 'true'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'api_errors', count(*)::double precision
    from signal where name = 'claude_code.api_error'
      and coalesce(attrs->>'attempt', '1') = '1'
      and ts >= $1 and ts < $2 group by device
  union all
  select device, 'sessions', count(*)::double precision
    from session where last_seen_at >= $1 and started_at < $2 group by device
),
p as (
  select metric,
         coalesce(sum(v) filter (where device = $3), 0) as work,
         coalesce(sum(v) filter (where device = $4), 0) as personal
  from m group by metric
)
select metric, work, personal,
       personal - work                                        as delta,
       round((personal - work) * 100.0
             / nullif(abs(work), 0)::numeric, 1)              as pct_diff
from p
order by array_position(
  array['sessions','active_hours','cost_usd','tokens_total','tokens_cache_read',
        'lines_added','lines_removed','tool_calls','tool_failures','api_errors'],
  metric);
```

Raw totals mostly measure how many hours you spent on each machine. The intensity view
is the comparison worth looking at:

```sql
-- wrap the CTE above, then:
select round((work_cost / nullif(work_hours, 0))::numeric, 2)     as work_usd_per_hour,
       round((pers_cost / nullif(pers_hours, 0))::numeric, 2)     as personal_usd_per_hour,
       round((work_lines / nullif(work_hours, 0))::numeric, 0)    as work_lines_per_hour,
       round((pers_lines / nullif(pers_hours, 0))::numeric, 0)    as personal_lines_per_hour,
       round((work_cost / nullif(work_lines, 0) * 100)::numeric, 3) as work_usd_per_100_lines,
       round((pers_cost / nullif(pers_lines, 0) * 100)::numeric, 3) as personal_usd_per_100_lines
from (select
        max(work)     filter (where metric = 'cost_usd')     as work_cost,
        max(personal) filter (where metric = 'cost_usd')     as pers_cost,
        max(work)     filter (where metric = 'active_hours') as work_hours,
        max(personal) filter (where metric = 'active_hours') as pers_hours,
        max(work)     filter (where metric = 'lines_added')  as work_lines,
        max(personal) filter (where metric = 'lines_added')  as pers_lines
      from p) x;
```

### Time series (any panel, bucketed)

Every panel above becomes a chart by adding a bucket key. `$5` is `'1 hour'` or
`'1 day'`.

```sql
select date_trunc('hour', ts) as bucket, device, sum(value) as usd
from signal
where name = 'claude_code.cost.usage' and ts >= $1 and ts < $2
group by 1, 2
order by 1;
```

### Ingest health

```sql
select device, max(ts) as last_signal_at, max(ingested_at) as last_delivery_at,
       count(*) filter (where ingested_at > now() - interval '1 hour') as rows_last_hour
from signal
where ts > now() - interval '7 days'
group by device;
```

## 5. Cardinality and volume, one developer, two machines

Assume four active hours a day per machine, both machines used most days.

**Metric datapoints.** Default export interval is 60s and DELTA suppresses series with
no change in the interval. Per active minute, per machine: cost.usage 1-2, token.usage
4-8, lines_of_code.count 0-2, active_time.total 1, session.count 0-1,
code_edit_tool.decision 0-1. Call it 12. That is ~2,900 rows/day/machine, **~5,800/day
for both**.

**Log records.** Per active hour, per machine: api_request ~60, tool_result ~150,
tool_decision ~30, user_prompt ~20, assistant_response ~60, hook events ~50,
api_error ~2. About 370. Four hours, two machines: **~3,000/day**.

**Total ~9,000 rows/day. ~3.3M rows/year.** A heavy day on both machines peaks near
25,000 rows.

**Row width.** Measured, not estimated. 200k rows in the proportion above, with
realistic `attrs` payloads after stripping the six session-constant and five resource
attributes to the `session` table, occupy 60 MB of heap. **314 bytes per row.**

**Storage at 400-day retention**, extrapolated from that measurement:

| object | per row | at 3.3M rows |
|---|---|---|
| heap | 314 B | 1.04 GB |
| `signal_pkey` | 43 B | 143 MB |
| `signal_name_ts_idx` | 52 B | 172 MB |
| `signal_attrs_gin_idx` | 20 B | 67 MB |
| `signal_ts_brin_idx` | 0.12 B | 400 KB |
| **total** | | **~1.4 GB** |

Comfortably inside a paid Neon branch; too big for the 0.5 GB free tier past about
four months, which is why the per-name retention tiers in section 1 exist rather than
being a nice-to-have. Without the session-attribute stripping the heap alone would be
roughly 2.5 GB.

The GIN index is the cheapest of the three btree-scale indexes, not the most
expensive. I expected the opposite before measuring. The id-key subtraction is what
makes that true.

**Attribute cardinality.**

| dimension | distinct values |
|---|---|
| `device` | 2 |
| `session.id` | ~2,000-3,000/year |
| `model` | 3-5 |
| `type` (tokens) | 4 |
| `type` (lines) | 2 |
| `query_source` | ~5 |
| `tool_name` | ~25, more with MCP servers |
| `status_code` | ~6 |
| `decision` / `source` | ~3 / ~4 |
| `language` | ~15 |
| `request_id`, `tool_use_id`, `prompt.id`, `message.uuid` | unbounded, 1 per row |

Distinct metric series is around 300 in practice. The theoretical worst case is
`claude_code.code_edit_tool.decision`, whose
`tool_name × decision × source × language` product is bounded near 2,000 per device.
Harmless for a `SUM`, but it is the one metric where a future attribute could make the
series count jump, and the one to watch.

The unbounded id columns are precisely what the GIN index subtracts in section 1. That
subtraction is worth roughly 13M dead index entries a year.

**Request rate.** Metrics: 1 POST/60s/machine. Logs: batched, ~1 POST/5s/machine while
active. Peak under 1 req/s combined. A single Vercel function with
`@neondatabase/serverless` HTTP handles this without connection pooling concerns,
because each ingest is one or two statements and nothing holds a session.

## 6. The three biggest weaknesses of this design

**1. Numbers are strings and the planner is blind to them.** OTLP JSON encodes int64
as a JSON string, and I preserve that verbatim so the dedupe hash matches the wire.
So `duration_ms`, `input_tokens`, `status_code`, and `tool_result_size_bytes` are all
text inside `attrs`. Every latency percentile pays a text-to-double cast per row and
gets zero statistics: Postgres has no ndistinct or histogram for `attrs->>'duration_ms'`
without an expression index, so it falls back to a default selectivity guess. Today
every such predicate sits inside an aggregate over an already-selected range, so the
bad estimate has nothing to ruin. The day someone joins `signal` to itself on a jsonb
key, or writes a `where (attrs->>'duration_ms')::double precision > 5000` filter that
the planner has to cost, they will get a plan chosen by dice roll. A typed
`tool_result` table with `duration_ms integer not null` would be strictly better for
the two heaviest panels. I traded that away for the property that a Claude Code
release adding a new event field requires zero schema work, and I still think that is
the right trade at two machines. It is a trade, not a free lunch.

**2. One table means one retention shape, and per-name retention smuggles the
special-casing back in.** The whole argument for a single fact table is that no signal
gets privileged treatment. Then section 1 privileges five of them, because keeping 400
days of `hook_execution_start` to preserve 400 days of `cost.usage` is absurd when
they share a heap. So the "no per-signal special cases" property survives in the DDL
and dies in the retention job, which is now a literal list of names that must be
updated whenever Claude Code ships a noisy new event. That is exactly the migration this
design claimed to avoid, just relocated from `ALTER TABLE` to a cron query. A separate
`event` table with its own retention would have been honest about this. The mitigating
fact is that a stale retention list over-retains rather than deleting something it
should not, so the failure mode is a slightly larger bill, not lost data.

**3. Dedupe is only as good as the exporter's determinism, and nothing detects when it
stops being.** The key is a hash of fields the exporter chose. If a future Claude Code
re-batches on retry, re-stamping `timeUnixNano` on the resent datapoints, or drops
`event.sequence`, or changes attribute serialization, every retried record hashes
differently and lands as a new row. Cost silently doubles for the affected window and
nothing in the database can tell, because a duplicate that hashes differently is
indistinguishable from a real datapoint. There is no in-schema fix; the key cannot
validate the assumption it rests on. The cheap mitigation is an invariant check rather
than a guarantee: flag a device whose daily cost exceeds three times its trailing
14-day median, and periodically assert that
`select count(*) from signal where name = 'claude_code.api_request'
 group by session_id, attrs->>'request_id' having count(*) > 1` returns nothing.
Both are smoke alarms, not seatbelts.

## 7. Verification

This is not a paper design. Everything in sections 1, 2, and 4 was executed against
the project's provisioned Neon instance (PostgreSQL 18.6) in a throwaway schema, which
was dropped afterwards.

**DDL.** All of section 1 applies cleanly, including the GIN expression index over
`jsonb - text[]`. That operator is `jsonb_delete_array`, which is `immutable` and
therefore legal in an index expression. This was the one piece of the design most
likely to be invalid, and it is not.

**Idempotency.** The seed batch was replayed byte-identically through the exact
`jsonb_array_elements` + `ON CONFLICT DO NOTHING` statement from section 2. First run
inserted 25 signal rows, second run inserted 0, and `sum(value)` over
`claude_code.cost.usage` held at 0.88 across both. The `session` upsert converged
identically under replay via `least`/`greatest`.

**Queries.** Every query in section 4 ran and returned correct results against seeded
data, including the mixed-type `success` case: rows carrying jsonb `true`, the string
`"true"`, and jsonb `false` were counted correctly by `attrs->>'success' = 'true'`,
confirming that claim rather than assuming it.

**Two real bugs were found and fixed by running them.**

1. `round(sum(value) / 3600.0, 2)` fails with `function round(double precision,
   integer) does not exist`. `value` is `double precision` and `double / numeric`
   yields `double precision`, for which no two-argument `round` exists. Every such
   call now casts to `numeric` first. This would have broken the active-time panel and
   the entire intensity comparison.
2. `sum(...) filter (...)` returns `NULL`, not `0`, when a device has no matching
   rows, so the lines-of-code `net` column was null for any device that removed no
   lines. Now wrapped in `coalesce(..., 0)`. Similarly `attrs->>'success' <> 'true'`
   silently drops rows where the key is absent, since `NULL <> 'true'` is `NULL`; the
   comparison query now uses `is distinct from`.

**Plans**, on 200k rows after `ANALYZE`:

- Total cost over a one-month range: Bitmap Index Scan on `signal_name_ts_idx`,
  1,488 rows, **1.06 ms**. The hot path uses the index it was built for.
- The GIN filter combined with a time range: `BitmapAnd` of `signal_ts_brin_idx` and
  `signal_attrs_gin_idx`, **11.8 ms**. The subtraction expression in the query matched
  the index expression, so the index is genuinely usable and not decorative.
- `delete from signal where ts < ...`: Bitmap Index Scan on `signal_ts_brin_idx`
  touching 2 index buffers, **1.32 ms**. Retention drives off BRIN as designed.

**Not verified.** Nothing here proves the exporter's retry determinism, which is
weakness 3 and is unprovable from inside the database. The volume figures in section 5
are extrapolations from a measured 200k-row sample, not from real traffic; the row
count per day is still an estimate and the byte-per-row figure is not.

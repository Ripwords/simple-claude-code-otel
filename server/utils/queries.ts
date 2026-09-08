import { EVENTS, METRICS } from '#shared/types'
import type { BreakdownRow, DeviceSummary, MetricKey, SeriesPoint } from '#shared/types'
import { db } from './db'
import { DURATION_BUCKET_SQL } from './rollup'
import type { ResolvedRange } from './range'

export const BREAKDOWN_KEYS = ['model', 'toolName', 'tokenType', 'editDecision', 'errorStatus'] as const
export type BreakdownKey = typeof BREAKDOWN_KEYS[number]

const OTHER_KEY = 'Other'
const UNKNOWN_KEY = 'unknown'
const BREAKDOWN_LIMIT = 20

const UTC_ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`

// Every query is bounded by the same four parameters and split at the same seam. The rollup
// half covers complete days before it, the raw half covers everything after. Because the two
// intervals meet rather than overlap, no row can be counted twice however the range falls;
// an inverted interval simply selects nothing, which is what makes "entirely today" and
// "entirely historical" need no special case.
const ROLLUP_WINDOW = `day >= ($1::timestamptz at time zone 'utc')::date
  and day < (least($2::timestamptz, $4::timestamptz) at time zone 'utc')::date
  and ($3::uuid[] is null or device_id = any($3))`

const RAW_WINDOW = `ts >= greatest($1::timestamptz, $4::timestamptz) and ts < $2::timestamptz
  and ($3::uuid[] is null or device_id = any($3))`

// The attribute each metric is broken down by, spelled once. metric_daily stores the result
// of this in attr_key; the raw half has to compute it to line up with the rollup half.
const METRIC_ATTR_KEY = `coalesce(case metric
  when '${METRICS.tokens}' then attrs->>'type'
  when '${METRICS.linesOfCode}' then attrs->>'type'
  when '${METRICS.editDecision}' then attrs->>'decision'
end, '')`

const EVENT_ATTR_KEY = `coalesce(case name
  when '${EVENTS.toolResult}' then attrs->>'tool_name'
  when '${EVENTS.apiError}' then attrs->>'status_code'
end, '')`

const FAILURES = `count(*) filter (where name = '${EVENTS.toolResult}' and attrs->>'success' is distinct from 'true')`

// Grouping on the device primary key rather than the name is what lets a rename keep its
// history, and selecting d.name beside it is legal because Postgres reads the functional
// dependency off that key. Revoked devices join in like any other: revocation stops ingest,
// it does not erase spend that already happened.
const DEVICE_JOIN = `join telemetry.device d on d.id = f.device_id`

/**
 * A range read entirely from raw has no rollup half. Collapsing the seam onto `from` empties
 * it arithmetically, so both modes run the identical SQL rather than branching.
 */
function params(range: ResolvedRange, ...extra: unknown[]): unknown[] {
  const seam = range.source === 'raw' ? range.from : range.seam
  return [range.from, range.to, range.devices, seam, ...extra]
}

export async function querySummary(range: ResolvedRange): Promise<DeviceSummary[]> {
  const args = params(range)

  const metricRows = await select(`
    with facts as (
      select device_id, metric, model, attr_key, value from telemetry.metric_daily where ${ROLLUP_WINDOW}
      union all
      select device_id, metric, coalesce(model, ''), ${METRIC_ATTR_KEY}, value::numeric
      from telemetry.metric_point where ${RAW_WINDOW}
    )
    select
      d.id as device_id,
      d.name as device,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.cost}'), 0) as cost_usd,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.tokens}' and f.attr_key = 'input'), 0) as input_tokens,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.tokens}' and f.attr_key = 'output'), 0) as output_tokens,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.tokens}' and f.attr_key = 'cacheRead'), 0) as cache_read_tokens,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.tokens}' and f.attr_key = 'cacheCreation'), 0) as cache_creation_tokens,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.linesOfCode}' and f.attr_key = 'added'), 0) as lines_added,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.linesOfCode}' and f.attr_key = 'removed'), 0) as lines_removed,
      coalesce(sum(f.value) filter (where f.metric = '${METRICS.activeTime}'), 0) as active_seconds
    from facts f
    ${DEVICE_JOIN}
    group by d.id
  `, args)

  const eventRows = await select(`
    with facts as (
      select device_id, name, events, failures from telemetry.event_daily where ${ROLLUP_WINDOW}
      union all
      select device_id, name, count(*), ${FAILURES} from telemetry.event where ${RAW_WINDOW} group by 1, 2
    )
    select
      d.id as device_id,
      d.name as device,
      coalesce(sum(f.events) filter (where f.name = '${EVENTS.toolResult}'), 0) as tool_calls,
      coalesce(sum(f.failures) filter (where f.name = '${EVENTS.toolResult}'), 0) as tool_failures,
      coalesce(sum(f.events) filter (where f.name = '${EVENTS.apiRequest}'), 0) as api_requests,
      coalesce(sum(f.events) filter (where f.name = '${EVENTS.apiError}'), 0) as api_errors
    from facts f
    ${DEVICE_JOIN}
    group by d.id
  `, args)

  // Sessions cross midnight, so a per-day distinct count cannot be summed. telemetry.session
  // already holds one exact row per session and is small enough to keep for the full rollup
  // window, so it answers this directly instead.
  const sessionRows = await select(`
    select device_id, count(*) as sessions
    from telemetry.session
    where started_at >= $1::timestamptz and started_at < $2::timestamptz
      and ($3::uuid[] is null or device_id = any($3))
    group by 1
  `, [range.from, range.to, range.devices])

  const latencyRows = await select(percentileQuery(), args)

  const summaries = new Map<string, DeviceSummary>()
  const forDevice = (deviceId: string, name?: unknown) => {
    const existing = summaries.get(deviceId)
    if (existing) return existing
    const created = emptySummary(deviceId, str(name))
    summaries.set(deviceId, created)
    return created
  }

  for (const row of metricRows) {
    const summary = forDevice(str(row.device_id), row.device)
    summary.costUsd = num(row.cost_usd)
    summary.inputTokens = num(row.input_tokens)
    summary.outputTokens = num(row.output_tokens)
    summary.cacheReadTokens = num(row.cache_read_tokens)
    summary.cacheCreationTokens = num(row.cache_creation_tokens)
    summary.linesAdded = num(row.lines_added)
    summary.linesRemoved = num(row.lines_removed)
    summary.activeSeconds = num(row.active_seconds)
  }

  for (const row of eventRows) {
    const summary = forDevice(str(row.device_id), row.device)
    summary.toolCalls = num(row.tool_calls)
    summary.toolFailures = num(row.tool_failures)
    summary.apiRequests = num(row.api_requests)
    summary.apiErrors = num(row.api_errors)
  }

  const named = new Map(metricRows.concat(eventRows).map(row => [str(row.device_id), str(row.device)]))

  for (const row of sessionRows) {
    const deviceId = str(row.device_id)
    if (!summaries.has(deviceId) && !named.has(deviceId)) continue
    forDevice(deviceId, named.get(deviceId)).sessions = num(row.sessions)
  }

  for (const row of latencyRows) {
    const summary = summaries.get(str(row.device_id))
    if (!summary) continue
    const tool = row.name === EVENTS.toolResult
    if (num(row.p) === 0.5) {
      if (tool) summary.p50ToolMs = nullableNum(row.value)
      else summary.p50ApiMs = nullableNum(row.value)
    } else {
      if (tool) summary.p95ToolMs = nullableNum(row.value)
      else summary.p95ApiMs = nullableNum(row.value)
    }
  }

  return [...summaries.values()].sort((a, b) => a.device.localeCompare(b.device))
}

/**
 * Percentiles from the merged latency histogram. The raw half is bucketed with the identical
 * expression the rollup was written with, so summing bucket counts is an exact merge and this
 * query never needs to know where the seam falls. `distinct on` takes the first bucket whose
 * running total crosses the target rank, and the fractional exponent places the answer inside
 * that bucket rather than at its edge.
 */
function percentileQuery(): string {
  return `
    with buckets as (
      select device_id, name, bucket, sum(n)::bigint as n
      from (
        select device_id, name, bucket, n from telemetry.event_duration_daily where ${ROLLUP_WINDOW}
        union all
        select device_id, name, ${DURATION_BUCKET_SQL('duration_ms')}, count(*)
        from telemetry.event
        where ${RAW_WINDOW} and duration_ms is not null
        group by 1, 2, 3
      ) s
      where name in ('${EVENTS.toolResult}', '${EVENTS.apiRequest}')
      group by 1, 2, 3
    ),
    cum as (
      select device_id, name, bucket, n,
        sum(n) over (partition by device_id, name order by bucket) as running,
        sum(n) over (partition by device_id, name) as total
      from buckets
    ),
    quantiles as (select unnest(array[0.5, 0.95]) as p)
    select distinct on (c.device_id, c.name, q.p)
      c.device_id, c.name, q.p,
      power(2::double precision, (c.bucket + least(1, greatest(0, (q.p * c.total - (c.running - c.n)) / c.n))) / 8.0) as value
    from cum c cross join quantiles q
    where c.running >= q.p * c.total
    order by c.device_id, c.name, q.p, c.bucket
  `
}

export async function queryTimeseries(range: ResolvedRange, metric: MetricKey, bucket: 'hour' | 'day'): Promise<SeriesPoint[]> {
  const args = params(range, METRICS[metric])

  // Hour buckets are only offered for a window that is entirely inside the raw window, so the
  // rollup's daily grain never has to be subdivided.
  const facts = bucket === 'hour'
    ? `select to_char(date_trunc('hour', ts at time zone 'utc'), ${UTC_ISO}) as bucket, device_id, value::numeric
       from telemetry.metric_point where metric = $5 and ${RAW_WINDOW}`
    : `select to_char(day::timestamp, ${UTC_ISO}) as bucket, device_id, value
       from telemetry.metric_daily where metric = $5 and ${ROLLUP_WINDOW}
       union all
       select to_char(date_trunc('day', ts at time zone 'utc'), ${UTC_ISO}), device_id, value::numeric
       from telemetry.metric_point where metric = $5 and ${RAW_WINDOW}`

  const rows = await select(`
    with facts as (${facts})
    select f.bucket, d.id as device_id, d.name as device, coalesce(sum(f.value), 0)::double precision as value
    from facts f
    ${DEVICE_JOIN}
    group by 1, 2, 3
    order by 1, 3
  `, args)

  return rows.map(row => ({
    bucket: str(row.bucket),
    deviceId: str(row.device_id),
    device: str(row.device),
    value: num(row.value)
  }))
}

export async function queryBreakdown(range: ResolvedRange, by: BreakdownKey): Promise<BreakdownRow[]> {
  const rows = await select(`
    with facts as (${BREAKDOWN_SOURCES[by]}),
    merged as (select device_id, key, sum(value) as value from facts group by 1, 2),
    ranked as (
      select device_id, key, value,
        row_number() over (partition by device_id order by value desc, key) as rn
      from merged
    )
    select f.device_id, d.name as device,
      case when f.rn <= ${BREAKDOWN_LIMIT} then f.key else '${OTHER_KEY}' end as key,
      sum(f.value) as value
    from ranked f
    ${DEVICE_JOIN}
    group by 1, 2, 3
    order by device, value desc, key
  `, params(range))

  return rows.map(row => ({
    deviceId: str(row.device_id),
    device: str(row.device),
    key: str(row.key),
    value: num(row.value)
  }))
}

// Each source unions the rollup half with the raw half and normalises both to
// (device_id, key, value). The re-aggregation in `merged` above is load-bearing: a key present
// in both halves arrives as two rows, and ranking them separately could push a genuinely
// top-twenty key into Other.
function metricBreakdown(metric: string, rollupKey: string, rawKey: string): string {
  return `
    select device_id, coalesce(nullif(${rollupKey}, ''), '${UNKNOWN_KEY}') as key, value
    from telemetry.metric_daily where metric = '${metric}' and ${ROLLUP_WINDOW}
    union all
    select device_id, coalesce(nullif(${rawKey}, ''), '${UNKNOWN_KEY}'), value::numeric
    from telemetry.metric_point where metric = '${metric}' and ${RAW_WINDOW}`
}

function eventBreakdown(name: string): string {
  return `
    select device_id, coalesce(nullif(attr_key, ''), '${UNKNOWN_KEY}') as key, events::numeric as value
    from telemetry.event_daily where name = '${name}' and ${ROLLUP_WINDOW}
    union all
    select device_id, coalesce(nullif(${EVENT_ATTR_KEY}, ''), '${UNKNOWN_KEY}'), 1::numeric
    from telemetry.event where name = '${name}' and ${RAW_WINDOW}`
}

const BREAKDOWN_SOURCES: Record<BreakdownKey, string> = {
  model: metricBreakdown(METRICS.cost, 'model', `coalesce(model, '')`),
  tokenType: metricBreakdown(METRICS.tokens, 'attr_key', `attrs->>'type'`),
  editDecision: metricBreakdown(METRICS.editDecision, 'attr_key', `attrs->>'decision'`),
  toolName: eventBreakdown(EVENTS.toolResult),
  errorStatus: eventBreakdown(EVENTS.apiError)
}

function emptySummary(deviceId: string, device: string): DeviceSummary {
  return {
    deviceId,
    device,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    linesAdded: 0,
    linesRemoved: 0,
    activeSeconds: 0,
    toolCalls: 0,
    toolFailures: 0,
    apiRequests: 0,
    apiErrors: 0,
    p50ToolMs: null,
    p95ToolMs: null,
    p50ApiMs: null,
    p95ApiMs: null
  }
}

async function select(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  return await db().query(text, params)
}

// The neon driver hands back bigint and numeric as strings.
function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function nullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value)
}

function str(value: unknown): string {
  return String(value ?? '')
}

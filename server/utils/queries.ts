import { EVENTS, METRICS } from '#shared/types'
import type { BreakdownRow, Bucket, DeviceSummary, MetricKey, SeriesPoint } from '#shared/types'
import { db } from './db'
import type { ResolvedRange } from './range'

export const BREAKDOWN_KEYS = ['model', 'toolName', 'tokenType', 'editDecision', 'errorStatus'] as const
export type BreakdownKey = typeof BREAKDOWN_KEYS[number]

const OTHER_KEY = 'Other'
const UNKNOWN_KEY = 'unknown'
const BREAKDOWN_LIMIT = 20

// Left unqualified so one predicate serves every fact table: neither `ts` nor `device_id`
// exists on telemetry.device, so both still resolve to the fact side under the join.
const RANGE_FILTER = `ts >= $1 and ts < $2 and ($3::uuid[] is null or device_id = any($3))`
const UTC_ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`

// Grouping on the device primary key rather than the name is what lets a rename keep its
// history, and selecting d.name beside it is legal because Postgres reads the functional
// dependency off that key. Revoked devices join in like any other: revocation stops ingest,
// it does not erase spend that already happened.
const DEVICE_JOIN = `join telemetry.device d on d.id = device_id`

export async function querySummary(range: ResolvedRange): Promise<DeviceSummary[]> {
  const params = [range.from, range.to, range.devices]

  const metricRows = await select(`
    select
      d.id as device_id,
      d.name as device,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.cost}'), 0) as cost_usd,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.tokens}' and m.attrs->>'type' = 'input'), 0) as input_tokens,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.tokens}' and m.attrs->>'type' = 'output'), 0) as output_tokens,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.tokens}' and m.attrs->>'type' = 'cacheRead'), 0) as cache_read_tokens,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.tokens}' and m.attrs->>'type' = 'cacheCreation'), 0) as cache_creation_tokens,
      coalesce(count(distinct m.session_id) filter (where m.metric = '${METRICS.session}'), 0) as sessions,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.linesOfCode}' and m.attrs->>'type' = 'added'), 0) as lines_added,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.linesOfCode}' and m.attrs->>'type' = 'removed'), 0) as lines_removed,
      coalesce(sum(m.value) filter (where m.metric = '${METRICS.activeTime}'), 0) as active_seconds
    from telemetry.metric_point m
    ${DEVICE_JOIN}
    where ${RANGE_FILTER}
    group by d.id
  `, params)

  const eventRows = await select(`
    select
      d.id as device_id,
      d.name as device,
      coalesce(count(*) filter (where e.name = '${EVENTS.toolResult}'), 0) as tool_calls,
      coalesce(count(*) filter (where e.name = '${EVENTS.toolResult}' and e.attrs->>'success' is distinct from 'true'), 0) as tool_failures,
      coalesce(count(*) filter (where e.name = '${EVENTS.apiRequest}'), 0) as api_requests,
      coalesce(count(*) filter (where e.name = '${EVENTS.apiError}'), 0) as api_errors,
      percentile_cont(0.5) within group (order by e.duration_ms) filter (where e.name = '${EVENTS.toolResult}') as p50_tool_ms,
      percentile_cont(0.95) within group (order by e.duration_ms) filter (where e.name = '${EVENTS.toolResult}') as p95_tool_ms,
      percentile_cont(0.5) within group (order by e.duration_ms) filter (where e.name = '${EVENTS.apiRequest}') as p50_api_ms,
      percentile_cont(0.95) within group (order by e.duration_ms) filter (where e.name = '${EVENTS.apiRequest}') as p95_api_ms
    from telemetry.event e
    ${DEVICE_JOIN}
    where ${RANGE_FILTER}
    group by d.id
  `, params)

  const summaries = new Map<string, DeviceSummary>()
  const forDevice = (row: Record<string, unknown>) => {
    const deviceId = str(row.device_id)
    const existing = summaries.get(deviceId)
    if (existing) return existing
    const created = emptySummary(deviceId, str(row.device))
    summaries.set(deviceId, created)
    return created
  }

  for (const row of metricRows) {
    const summary = forDevice(row)
    summary.costUsd = num(row.cost_usd)
    summary.inputTokens = num(row.input_tokens)
    summary.outputTokens = num(row.output_tokens)
    summary.cacheReadTokens = num(row.cache_read_tokens)
    summary.cacheCreationTokens = num(row.cache_creation_tokens)
    summary.sessions = num(row.sessions)
    summary.linesAdded = num(row.lines_added)
    summary.linesRemoved = num(row.lines_removed)
    summary.activeSeconds = num(row.active_seconds)
  }

  for (const row of eventRows) {
    const summary = forDevice(row)
    summary.toolCalls = num(row.tool_calls)
    summary.toolFailures = num(row.tool_failures)
    summary.apiRequests = num(row.api_requests)
    summary.apiErrors = num(row.api_errors)
    summary.p50ToolMs = nullableNum(row.p50_tool_ms)
    summary.p95ToolMs = nullableNum(row.p95_tool_ms)
    summary.p50ApiMs = nullableNum(row.p50_api_ms)
    summary.p95ApiMs = nullableNum(row.p95_api_ms)
  }

  return [...summaries.values()].sort((a, b) => a.device.localeCompare(b.device))
}

export async function queryTimeseries(range: ResolvedRange, metric: MetricKey, bucket: Bucket): Promise<SeriesPoint[]> {
  const rows = await select(`
    select
      to_char(date_trunc($4::text, m.ts) at time zone 'utc', ${UTC_ISO}) as bucket,
      d.id as device_id,
      d.name as device,
      coalesce(sum(m.value), 0) as value
    from telemetry.metric_point m
    ${DEVICE_JOIN}
    where m.metric = $5 and ${RANGE_FILTER}
    group by 1, d.id
    order by 1, 3
  `, [range.from, range.to, range.devices, bucket, METRICS[metric]])

  return rows.map(row => ({
    bucket: str(row.bucket),
    deviceId: str(row.device_id),
    device: str(row.device),
    value: num(row.value)
  }))
}

export async function queryBreakdown(range: ResolvedRange, by: BreakdownKey): Promise<BreakdownRow[]> {
  const rows = await select(`
    with grouped as (${BREAKDOWN_SOURCES[by]}),
    ranked as (
      select device_id, device, key, value,
        row_number() over (partition by device_id order by value desc, key) as rn
      from grouped
    )
    select device_id, device, case when rn <= ${BREAKDOWN_LIMIT} then key else '${OTHER_KEY}' end as key, sum(value) as value
    from ranked
    group by 1, 2, 3
    order by device, value desc, key
  `, [range.from, range.to, range.devices])

  return rows.map(row => ({
    deviceId: str(row.device_id),
    device: str(row.device),
    key: str(row.key),
    value: num(row.value)
  }))
}

const BREAKDOWN_SOURCES: Record<BreakdownKey, string> = {
  model: `
    select d.id as device_id, d.name as device, coalesce(m.model, '${UNKNOWN_KEY}') as key, coalesce(sum(m.value), 0) as value
    from telemetry.metric_point m
    ${DEVICE_JOIN}
    where m.metric = '${METRICS.cost}' and ${RANGE_FILTER}
    group by 1, 2, 3`,
  tokenType: `
    select d.id as device_id, d.name as device, coalesce(m.attrs->>'type', '${UNKNOWN_KEY}') as key, coalesce(sum(m.value), 0) as value
    from telemetry.metric_point m
    ${DEVICE_JOIN}
    where m.metric = '${METRICS.tokens}' and ${RANGE_FILTER}
    group by 1, 2, 3`,
  editDecision: `
    select d.id as device_id, d.name as device, coalesce(m.attrs->>'decision', '${UNKNOWN_KEY}') as key, coalesce(sum(m.value), 0) as value
    from telemetry.metric_point m
    ${DEVICE_JOIN}
    where m.metric = '${METRICS.editDecision}' and ${RANGE_FILTER}
    group by 1, 2, 3`,
  toolName: `
    select d.id as device_id, d.name as device, coalesce(e.attrs->>'tool_name', '${UNKNOWN_KEY}') as key, count(*)::double precision as value
    from telemetry.event e
    ${DEVICE_JOIN}
    where e.name = '${EVENTS.toolResult}' and ${RANGE_FILTER}
    group by 1, 2, 3`,
  errorStatus: `
    select d.id as device_id, d.name as device, coalesce(e.attrs->>'status_code', '${UNKNOWN_KEY}') as key, count(*)::double precision as value
    from telemetry.event e
    ${DEVICE_JOIN}
    where e.name = '${EVENTS.apiError}' and ${RANGE_FILTER}
    group by 1, 2, 3`
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

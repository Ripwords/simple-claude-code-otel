import { EVENTS, METRICS, UNLABELLED_DEVICE } from '#shared/types'
import type { BreakdownRow, Bucket, DeviceInfo, DeviceSummary, MetricKey, SeriesPoint } from '#shared/types'
import { db } from './db'
import type { ResolvedRange } from './range'

export const BREAKDOWN_KEYS = ['model', 'toolName', 'tokenType', 'editDecision', 'errorStatus'] as const
export type BreakdownKey = typeof BREAKDOWN_KEYS[number]

const OTHER_KEY = 'Other'
const UNKNOWN_KEY = 'unknown'
const BREAKDOWN_LIMIT = 20

const RANGE_FILTER = `ts >= $1 and ts < $2 and ($3::text[] is null or device = any($3))`
const UTC_ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`

export async function queryDevices(devices: string[] | null): Promise<DeviceInfo[]> {
  const rows = await select(`
    with session_agg as (
      select device, min(started_at) as first_seen, max(last_seen_at) as last_seen, count(*) as sessions
      from telemetry.session
      group by device
    )
    select
      coalesce(d.device, s.device) as device,
      to_char(least(d.first_seen, s.first_seen) at time zone 'utc', ${UTC_ISO}) as first_seen,
      to_char(coalesce(s.last_seen, d.first_seen) at time zone 'utc', ${UTC_ISO}) as last_seen,
      coalesce(s.sessions, 0) as sessions,
      to_char(d.acknowledged_at at time zone 'utc', ${UTC_ISO}) as acknowledged_at
    from telemetry.device d
    full outer join session_agg s on s.device = d.device
    where ($1::text[] is null or coalesce(d.device, s.device) = any($1))
    order by 1
  `, [devices])

  return rows.map(toDeviceInfo)
}

export async function acknowledgeDevice(device: string): Promise<DeviceInfo | null> {
  const updated = await select(
    'update telemetry.device set acknowledged_at = coalesce(acknowledged_at, now()) where device = $1 returning device',
    [device]
  )
  if (updated.length === 0) return null

  const [info] = await queryDevices([device])
  return info ?? null
}

function toDeviceInfo(row: Record<string, unknown>): DeviceInfo {
  const acknowledgedAt = row.acknowledged_at === null || row.acknowledged_at === undefined ? null : str(row.acknowledged_at)
  const device = str(row.device)
  return {
    device,
    firstSeen: str(row.first_seen),
    lastSeen: str(row.last_seen),
    sessions: num(row.sessions),
    acknowledgedAt,
    isNew: acknowledgedAt === null,
    isUnlabelled: device === UNLABELLED_DEVICE
  }
}

export async function querySummary(range: ResolvedRange): Promise<DeviceSummary[]> {
  const params = [range.from, range.to, range.devices]

  const metricRows = await select(`
    select
      device,
      coalesce(sum(value) filter (where metric = '${METRICS.cost}'), 0) as cost_usd,
      coalesce(sum(value) filter (where metric = '${METRICS.tokens}' and attrs->>'type' = 'input'), 0) as input_tokens,
      coalesce(sum(value) filter (where metric = '${METRICS.tokens}' and attrs->>'type' = 'output'), 0) as output_tokens,
      coalesce(sum(value) filter (where metric = '${METRICS.tokens}' and attrs->>'type' = 'cacheRead'), 0) as cache_read_tokens,
      coalesce(sum(value) filter (where metric = '${METRICS.tokens}' and attrs->>'type' = 'cacheCreation'), 0) as cache_creation_tokens,
      coalesce(count(distinct session_id) filter (where metric = '${METRICS.session}'), 0) as sessions,
      coalesce(sum(value) filter (where metric = '${METRICS.linesOfCode}' and attrs->>'type' = 'added'), 0) as lines_added,
      coalesce(sum(value) filter (where metric = '${METRICS.linesOfCode}' and attrs->>'type' = 'removed'), 0) as lines_removed,
      coalesce(sum(value) filter (where metric = '${METRICS.activeTime}'), 0) as active_seconds
    from telemetry.metric_point
    where ${RANGE_FILTER}
    group by device
  `, params)

  const eventRows = await select(`
    select
      device,
      coalesce(count(*) filter (where name = '${EVENTS.toolResult}'), 0) as tool_calls,
      coalesce(count(*) filter (where name = '${EVENTS.toolResult}' and attrs->>'success' is distinct from 'true'), 0) as tool_failures,
      coalesce(count(*) filter (where name = '${EVENTS.apiRequest}'), 0) as api_requests,
      coalesce(count(*) filter (where name = '${EVENTS.apiError}'), 0) as api_errors,
      percentile_cont(0.5) within group (order by duration_ms) filter (where name = '${EVENTS.toolResult}') as p50_tool_ms,
      percentile_cont(0.95) within group (order by duration_ms) filter (where name = '${EVENTS.toolResult}') as p95_tool_ms,
      percentile_cont(0.5) within group (order by duration_ms) filter (where name = '${EVENTS.apiRequest}') as p50_api_ms,
      percentile_cont(0.95) within group (order by duration_ms) filter (where name = '${EVENTS.apiRequest}') as p95_api_ms
    from telemetry.event
    where ${RANGE_FILTER}
    group by device
  `, params)

  const summaries = new Map<string, DeviceSummary>()
  const forDevice = (device: string) => {
    const existing = summaries.get(device)
    if (existing) return existing
    const created = emptySummary(device)
    summaries.set(device, created)
    return created
  }

  for (const row of metricRows) {
    const summary = forDevice(str(row.device))
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
    const summary = forDevice(str(row.device))
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
      to_char(date_trunc($4::text, ts) at time zone 'utc', ${UTC_ISO}) as bucket,
      device,
      coalesce(sum(value), 0) as value
    from telemetry.metric_point
    where metric = $5 and ${RANGE_FILTER}
    group by 1, 2
    order by 1, 2
  `, [range.from, range.to, range.devices, bucket, METRICS[metric]])

  return rows.map(row => ({
    bucket: str(row.bucket),
    device: str(row.device),
    value: num(row.value)
  }))
}

export async function queryBreakdown(range: ResolvedRange, by: BreakdownKey): Promise<BreakdownRow[]> {
  const rows = await select(`
    with grouped as (${BREAKDOWN_SOURCES[by]}),
    ranked as (
      select device, key, value, row_number() over (partition by device order by value desc, key) as rn
      from grouped
    )
    select device, case when rn <= ${BREAKDOWN_LIMIT} then key else '${OTHER_KEY}' end as key, sum(value) as value
    from ranked
    group by 1, 2
    order by device, value desc, key
  `, [range.from, range.to, range.devices])

  return rows.map(row => ({
    device: str(row.device),
    key: str(row.key),
    value: num(row.value)
  }))
}

const BREAKDOWN_SOURCES: Record<BreakdownKey, string> = {
  model: `
    select device, coalesce(model, '${UNKNOWN_KEY}') as key, coalesce(sum(value), 0) as value
    from telemetry.metric_point
    where metric = '${METRICS.cost}' and ${RANGE_FILTER}
    group by 1, 2`,
  tokenType: `
    select device, coalesce(attrs->>'type', '${UNKNOWN_KEY}') as key, coalesce(sum(value), 0) as value
    from telemetry.metric_point
    where metric = '${METRICS.tokens}' and ${RANGE_FILTER}
    group by 1, 2`,
  editDecision: `
    select device, coalesce(attrs->>'decision', '${UNKNOWN_KEY}') as key, coalesce(sum(value), 0) as value
    from telemetry.metric_point
    where metric = '${METRICS.editDecision}' and ${RANGE_FILTER}
    group by 1, 2`,
  toolName: `
    select device, coalesce(attrs->>'tool_name', '${UNKNOWN_KEY}') as key, count(*)::double precision as value
    from telemetry.event
    where name = '${EVENTS.toolResult}' and ${RANGE_FILTER}
    group by 1, 2`,
  errorStatus: `
    select device, coalesce(attrs->>'status_code', '${UNKNOWN_KEY}') as key, count(*)::double precision as value
    from telemetry.event
    where name = '${EVENTS.apiError}' and ${RANGE_FILTER}
    group by 1, 2`
}

function emptySummary(device: string): DeviceSummary {
  return {
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

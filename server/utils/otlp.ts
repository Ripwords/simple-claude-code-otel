import { createHash } from 'node:crypto'

export interface OtlpValue {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
}

export interface OtlpAttr {
  key: string
  value?: OtlpValue
}

export type AttrScalar = string | number | boolean
export type AttrMap = Record<string, AttrScalar>

export interface OtlpResource {
  attributes?: OtlpAttr[]
}

export interface OtlpDataPoint {
  attributes?: OtlpAttr[]
  startTimeUnixNano?: string | number
  timeUnixNano?: string | number
  asDouble?: number
  asInt?: string | number
}

export interface OtlpSum {
  aggregationTemporality?: number
  isMonotonic?: boolean
  dataPoints?: OtlpDataPoint[]
}

export interface OtlpMetric {
  name?: string
  unit?: string
  sum?: OtlpSum
}

export interface OtlpScopeMetrics {
  metrics?: OtlpMetric[]
}

export interface OtlpResourceMetrics {
  resource?: OtlpResource
  scopeMetrics?: OtlpScopeMetrics[]
}

export interface OtlpMetricsBody {
  resourceMetrics?: OtlpResourceMetrics[]
}

export interface OtlpLogRecord {
  timeUnixNano?: string | number
  body?: { stringValue?: string }
  attributes?: OtlpAttr[]
}

export interface OtlpScopeLogs {
  logRecords?: OtlpLogRecord[]
}

export interface OtlpResourceLogs {
  resource?: OtlpResource
  scopeLogs?: OtlpScopeLogs[]
}

export interface OtlpLogsBody {
  resourceLogs?: OtlpResourceLogs[]
}

export interface MetricRow {
  dedupeKey: string
  ts: Date
  deviceId: string
  sessionId: string | null
  metric: string
  model: string | null
  value: number
  attrs: AttrMap
}

export interface EventRow {
  dedupeKey: string
  ts: Date
  deviceId: string
  sessionId: string | null
  name: string
  model: string | null
  durationMs: number | null
  attrs: AttrMap
}

export interface SessionRow {
  sessionId: string
  deviceId: string
  startedAt: Date
  lastSeenAt: Date
  attrs: AttrMap
}

/** The Claude Code account a batch of telemetry says it came from. */
export interface BatchAccount {
  uuid: string
  email: string | null
}

export interface Statement {
  text: string
  params: unknown[]
}

export type TransformResult<Row>
  = | { ok: true, rows: Row[], sessions: SessionRow[], account: BatchAccount | null }
    | { ok: false, error: string }

export const FIELD_SEP = '\u001f'
export const PAIR_SEP = '\u001e'

export const SESSION_ATTR_KEYS = [
  'user.id',
  'user.email',
  'user.account_uuid',
  'user.account_id',
  'organization.id',
  'terminal.type'
] as const

export const SESSION_RESOURCE_ATTR_KEYS = [
  'service.version',
  'os.type',
  'os.version',
  'host.arch'
] as const

export const NOISY_EVENT_NAMES = [
  'claude_code.hook_execution_start',
  'claude_code.hook_execution_complete',
  'claude_code.hook_registered',
  'claude_code.plugin_loaded',
  'claude_code.mcp_server_connection'
] as const

const DELTA_TEMPORALITY = 1
const CHUNK_SIZE = 500

const METRIC_STRIPPED_KEYS = new Set<string>(['model', 'session.id', 'device.name', ...SESSION_ATTR_KEYS])
const EVENT_STRIPPED_KEYS = new Set<string>(['model', 'session.id', 'duration_ms', 'device.name', ...SESSION_ATTR_KEYS])

export function attrsToMap(attrs: OtlpAttr[] | undefined): AttrMap {
  const map: AttrMap = {}
  for (const attr of attrs ?? []) {
    const value = attr.value
    if (!value) continue
    if (value.stringValue !== undefined) map[attr.key] = value.stringValue
    else if (value.intValue !== undefined) map[attr.key] = Number(value.intValue)
    else if (value.doubleValue !== undefined) map[attr.key] = value.doubleValue
    else if (value.boolValue !== undefined) map[attr.key] = value.boolValue
  }
  return map
}

export function nanosToDate(nanos: string | number): Date {
  const digits = String(nanos)
  if (!/^\d+$/.test(digits)) return new Date(Number(nanos) / 1e6)
  return new Date(digits.length > 6 ? Number(digits.slice(0, -6)) : 0)
}

export function dedupeKey(parts: string[]): string {
  const hex = createHash('sha256').update(parts.join(FIELD_SEP)).digest('hex').slice(0, 32)
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')
}

export function transformMetrics(body: OtlpMetricsBody, deviceId: string): TransformResult<MetricRow> {
  const rows: MetricRow[] = []
  const sessions = new Map<string, SessionRow>()
  let account: BatchAccount | null = null

  for (const resourceMetrics of body.resourceMetrics ?? []) {
    const resourceAttrs = attrsToMap(resourceMetrics.resource?.attributes)

    for (const scope of resourceMetrics.scopeMetrics ?? []) {
      for (const metric of scope.metrics ?? []) {
        const sum = metric.sum
        if (!sum) continue
        const name = metric.name ?? ''

        // Ingest sums increments. Under CUMULATIVE every datapoint is a running total, so summing
        // would inflate every dashboard number with no other symptom. Refuse the batch instead.
        if (sum.aggregationTemporality !== DELTA_TEMPORALITY) {
          return {
            ok: false,
            error: `metric ${name} has aggregationTemporality ${String(sum.aggregationTemporality)}, expected ${DELTA_TEMPORALITY} (DELTA)`
          }
        }

        for (const point of sum.dataPoints ?? []) {
          const pointAttrs = attrsToMap(point.attributes)
          const ts = nanosToDate(point.timeUnixNano ?? 0)
          const sessionId = stringAttr(pointAttrs, 'session.id')

          rows.push({
            dedupeKey: dedupeKey([
              name,
              String(point.startTimeUnixNano ?? ''),
              String(point.timeUnixNano ?? ''),
              deviceId,
              sortedPairs(pointAttrs)
            ]),
            ts,
            deviceId,
            sessionId,
            metric: name,
            model: stringAttr(pointAttrs, 'model'),
            value: point.asDouble ?? Number(point.asInt ?? 0),
            attrs: stripKeys(pointAttrs, METRIC_STRIPPED_KEYS)
          })

          if (!account) account = readAccount(pointAttrs)
          accumulateSession(sessions, sessionId, deviceId, ts, pointAttrs, resourceAttrs)
        }
      }
    }
  }

  return { ok: true, rows, sessions: [...sessions.values()], account }
}

export function transformLogs(body: OtlpLogsBody, deviceId: string): TransformResult<EventRow> {
  const rows: EventRow[] = []
  const sessions = new Map<string, SessionRow>()
  let account: BatchAccount | null = null

  for (const resourceLogs of body.resourceLogs ?? []) {
    const resourceAttrs = attrsToMap(resourceLogs.resource?.attributes)

    for (const scope of resourceLogs.scopeLogs ?? []) {
      for (const record of scope.logRecords ?? []) {
        const name = record.body?.stringValue
        if (!name) continue

        const recordAttrs = attrsToMap(record.attributes)
        const ts = nanosToDate(record.timeUnixNano ?? 0)
        const sessionId = stringAttr(recordAttrs, 'session.id')

        rows.push({
          dedupeKey: dedupeKey([
            name,
            String(record.timeUnixNano ?? ''),
            deviceId,
            sortedPairs(recordAttrs)
          ]),
          ts,
          deviceId,
          sessionId,
          name,
          model: stringAttr(recordAttrs, 'model'),
          durationMs: toDurationMs(recordAttrs['duration_ms']),
          attrs: stripKeys(recordAttrs, EVENT_STRIPPED_KEYS)
        })

        if (!account) account = readAccount(recordAttrs)
        accumulateSession(sessions, sessionId, deviceId, ts, recordAttrs, resourceAttrs)
      }
    }
  }

  return { ok: true, rows, sessions: [...sessions.values()], account }
}

export function buildMetricInserts(rows: MetricRow[]): Statement[] {
  return chunk(rows).map((batch) => {
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const n = params.length
      params.push(row.dedupeKey, row.ts.toISOString(), row.deviceId, row.sessionId, row.metric, row.model, row.value, JSON.stringify(row.attrs))
      return `($${n + 1}, $${n + 2}::timestamptz, $${n + 3}::uuid, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}::jsonb)`
    })
    return {
      text: `insert into telemetry.metric_point (dedupe_key, ts, device_id, session_id, metric, model, value, attrs) values ${tuples.join(', ')} on conflict (dedupe_key) do nothing`,
      params
    }
  })
}

export function buildEventInserts(rows: EventRow[]): Statement[] {
  return chunk(rows).map((batch) => {
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const n = params.length
      params.push(row.dedupeKey, row.ts.toISOString(), row.deviceId, row.sessionId, row.name, row.model, row.durationMs, JSON.stringify(row.attrs))
      return `($${n + 1}, $${n + 2}::timestamptz, $${n + 3}::uuid, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}::jsonb)`
    })
    return {
      text: `insert into telemetry.event (dedupe_key, ts, device_id, session_id, name, model, duration_ms, attrs) values ${tuples.join(', ')} on conflict (dedupe_key) do nothing`,
      params
    }
  })
}

export function buildSessionUpserts(sessions: SessionRow[]): Statement[] {
  return chunk(sessions).map((batch) => {
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const n = params.length
      params.push(row.sessionId, row.deviceId, row.startedAt.toISOString(), row.lastSeenAt.toISOString(), JSON.stringify(row.attrs))
      return `($${n + 1}, $${n + 2}::uuid, $${n + 3}::timestamptz, $${n + 4}::timestamptz, $${n + 5}::jsonb)`
    })
    return {
      text: `insert into telemetry.session (session_id, device_id, started_at, last_seen_at, attrs) values ${tuples.join(', ')} `
        + 'on conflict (session_id) do update set '
        + 'last_seen_at = greatest(telemetry.session.last_seen_at, excluded.last_seen_at), '
        + 'started_at = least(telemetry.session.started_at, excluded.started_at), '
        + 'attrs = telemetry.session.attrs || excluded.attrs',
      params
    }
  })
}

// Claude Code only attaches account attributes while signed in, so an absent uuid means
// "unauthenticated", not "a different account".
function readAccount(attrs: AttrMap): BatchAccount | null {
  const uuid = stringAttr(attrs, 'user.account_uuid')
  return uuid === null ? null : { uuid, email: stringAttr(attrs, 'user.email') }
}

function accumulateSession(
  sessions: Map<string, SessionRow>,
  sessionId: string | null,
  deviceId: string,
  ts: Date,
  pointAttrs: AttrMap,
  resourceAttrs: AttrMap
): void {
  if (!sessionId) return

  const attrs = {
    ...pickKeys(pointAttrs, SESSION_ATTR_KEYS),
    ...pickKeys(resourceAttrs, SESSION_RESOURCE_ATTR_KEYS)
  }

  const existing = sessions.get(sessionId)
  if (!existing) {
    sessions.set(sessionId, { sessionId, deviceId, startedAt: ts, lastSeenAt: ts, attrs })
    return
  }

  if (ts < existing.startedAt) existing.startedAt = ts
  if (ts > existing.lastSeenAt) existing.lastSeenAt = ts
  Object.assign(existing.attrs, attrs)
}

function stringAttr(attrs: AttrMap, key: string): string | null {
  const value = attrs[key]
  return value === undefined ? null : String(value)
}

function toDurationMs(value: AttrScalar | undefined): number | null {
  if (value === undefined || typeof value === 'boolean') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

function sortedPairs(attrs: AttrMap): string {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join(PAIR_SEP)
}

function stripKeys(attrs: AttrMap, stripped: Set<string>): AttrMap {
  const kept: AttrMap = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (!stripped.has(key)) kept[key] = value
  }
  return kept
}

function pickKeys(attrs: AttrMap, keys: readonly string[]): AttrMap {
  const picked: AttrMap = {}
  for (const key of keys) {
    const value = attrs[key]
    if (value !== undefined) picked[key] = value
  }
  return picked
}

function chunk<T>(rows: T[]): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE))
  }
  return chunks
}

// Ingest never creates a device; the row already exists or the request was 401. `least`/`greatest`
// over the stored value make the write idempotent under replay and correct for out-of-order batches,
// which matters because the null-to-set transition of first_seen is what announces a provisioned
// machine as reporting.
export function buildDeviceLivenessUpdate(deviceId: string, rows: readonly { ts: Date }[]): Statement[] {
  if (rows.length === 0) return []

  let earliest = rows[0]!.ts
  let latest = rows[0]!.ts
  for (const row of rows) {
    if (row.ts < earliest) earliest = row.ts
    if (row.ts > latest) latest = row.ts
  }

  return [{
    text: 'update telemetry.device set '
      + 'first_seen = least(coalesce(first_seen, $2::timestamptz), $2::timestamptz), '
      + 'last_seen_at = greatest(coalesce(last_seen_at, $3::timestamptz), $3::timestamptz) '
      + 'where id = $1::uuid',
    params: [deviceId, earliest.toISOString(), latest.toISOString()]
  }]
}

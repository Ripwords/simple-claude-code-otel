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
  device: string
  sessionId: string | null
  metric: string
  model: string | null
  value: number
  attrs: AttrMap
}

export interface EventRow {
  dedupeKey: string
  ts: Date
  device: string
  sessionId: string | null
  name: string
  model: string | null
  durationMs: number | null
  attrs: AttrMap
}

export interface SessionRow {
  sessionId: string
  device: string
  startedAt: Date
  lastSeenAt: Date
  attrs: AttrMap
}

export interface Statement {
  text: string
  params: unknown[]
}

export type TransformResult<Row>
  = | { ok: true, rows: Row[], sessions: SessionRow[] }
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

export function resolveDevice(resourceAttrs: AttrMap, pointAttrs: AttrMap): string {
  return nonEmptyString(resourceAttrs['device.name'])
    ?? nonEmptyString(pointAttrs['device.name'])
    ?? 'unknown'
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

export function transformMetrics(body: OtlpMetricsBody): TransformResult<MetricRow> {
  const rows: MetricRow[] = []
  const sessions = new Map<string, SessionRow>()

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
          const device = resolveDevice(resourceAttrs, pointAttrs)
          const ts = nanosToDate(point.timeUnixNano ?? 0)
          const sessionId = stringAttr(pointAttrs, 'session.id')

          rows.push({
            dedupeKey: dedupeKey([
              name,
              String(point.startTimeUnixNano ?? ''),
              String(point.timeUnixNano ?? ''),
              device,
              sortedPairs(pointAttrs)
            ]),
            ts,
            device,
            sessionId,
            metric: name,
            model: stringAttr(pointAttrs, 'model'),
            value: point.asDouble ?? Number(point.asInt ?? 0),
            attrs: stripKeys(pointAttrs, METRIC_STRIPPED_KEYS)
          })

          accumulateSession(sessions, sessionId, device, ts, pointAttrs, resourceAttrs)
        }
      }
    }
  }

  return { ok: true, rows, sessions: [...sessions.values()] }
}

export function transformLogs(body: OtlpLogsBody): TransformResult<EventRow> {
  const rows: EventRow[] = []
  const sessions = new Map<string, SessionRow>()

  for (const resourceLogs of body.resourceLogs ?? []) {
    const resourceAttrs = attrsToMap(resourceLogs.resource?.attributes)

    for (const scope of resourceLogs.scopeLogs ?? []) {
      for (const record of scope.logRecords ?? []) {
        const name = record.body?.stringValue
        if (!name) continue

        const recordAttrs = attrsToMap(record.attributes)
        const device = resolveDevice(resourceAttrs, recordAttrs)
        const ts = nanosToDate(record.timeUnixNano ?? 0)
        const sessionId = stringAttr(recordAttrs, 'session.id')

        rows.push({
          dedupeKey: dedupeKey([
            name,
            String(record.timeUnixNano ?? ''),
            device,
            sortedPairs(recordAttrs)
          ]),
          ts,
          device,
          sessionId,
          name,
          model: stringAttr(recordAttrs, 'model'),
          durationMs: toDurationMs(recordAttrs['duration_ms']),
          attrs: stripKeys(recordAttrs, EVENT_STRIPPED_KEYS)
        })

        accumulateSession(sessions, sessionId, device, ts, recordAttrs, resourceAttrs)
      }
    }
  }

  return { ok: true, rows, sessions: [...sessions.values()] }
}

export function buildMetricInserts(rows: MetricRow[]): Statement[] {
  return chunk(rows).map((batch) => {
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const n = params.length
      params.push(row.dedupeKey, row.ts.toISOString(), row.device, row.sessionId, row.metric, row.model, row.value, JSON.stringify(row.attrs))
      return `($${n + 1}, $${n + 2}::timestamptz, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}::jsonb)`
    })
    return {
      text: `insert into telemetry.metric_point (dedupe_key, ts, device, session_id, metric, model, value, attrs) values ${tuples.join(', ')} on conflict (dedupe_key) do nothing`,
      params
    }
  })
}

export function buildEventInserts(rows: EventRow[]): Statement[] {
  return chunk(rows).map((batch) => {
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const n = params.length
      params.push(row.dedupeKey, row.ts.toISOString(), row.device, row.sessionId, row.name, row.model, row.durationMs, JSON.stringify(row.attrs))
      return `($${n + 1}, $${n + 2}::timestamptz, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}::jsonb)`
    })
    return {
      text: `insert into telemetry.event (dedupe_key, ts, device, session_id, name, model, duration_ms, attrs) values ${tuples.join(', ')} on conflict (dedupe_key) do nothing`,
      params
    }
  })
}

export function buildSessionUpserts(sessions: SessionRow[]): Statement[] {
  return chunk(sessions).map((batch) => {
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const n = params.length
      params.push(row.sessionId, row.device, row.startedAt.toISOString(), row.lastSeenAt.toISOString(), JSON.stringify(row.attrs))
      return `($${n + 1}, $${n + 2}, $${n + 3}::timestamptz, $${n + 4}::timestamptz, $${n + 5}::jsonb)`
    })
    return {
      text: `insert into telemetry.session (session_id, device, started_at, last_seen_at, attrs) values ${tuples.join(', ')} `
        + 'on conflict (session_id) do update set '
        + 'last_seen_at = greatest(telemetry.session.last_seen_at, excluded.last_seen_at), '
        + 'started_at = least(telemetry.session.started_at, excluded.started_at), '
        + 'attrs = telemetry.session.attrs || excluded.attrs',
      params
    }
  })
}

function accumulateSession(
  sessions: Map<string, SessionRow>,
  sessionId: string | null,
  device: string,
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
    sessions.set(sessionId, { sessionId, device, startedAt: ts, lastSeenAt: ts, attrs })
    return
  }

  if (ts < existing.startedAt) existing.startedAt = ts
  if (ts > existing.lastSeenAt) existing.lastSeenAt = ts
  Object.assign(existing.attrs, attrs)
}

function nonEmptyString(value: AttrScalar | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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

export interface DeviceRow {
  device: string
  firstSeen: Date
}

export function foldDevices(rows: readonly { device: string, ts: Date }[]): DeviceRow[] {
  const devices = new Map<string, DeviceRow>()
  for (const row of rows) {
    const existing = devices.get(row.device)
    if (!existing) devices.set(row.device, { device: row.device, firstSeen: row.ts })
    else if (row.ts < existing.firstSeen) existing.firstSeen = row.ts
  }
  return [...devices.values()]
}

export function buildDeviceUpserts(devices: DeviceRow[]): Statement[] {
  return chunk(devices).map((batch) => {
    const params: unknown[] = []
    const tuples = batch.map((row) => {
      const n = params.length
      params.push(row.device, row.firstSeen.toISOString())
      return `($${n + 1}, $${n + 2}::timestamptz)`
    })
    return {
      text: `insert into telemetry.device (device, first_seen) values ${tuples.join(', ')} `
        + 'on conflict (device) do update set '
        + 'first_seen = least(telemetry.device.first_seen, excluded.first_seen)',
      params
    }
  })
}

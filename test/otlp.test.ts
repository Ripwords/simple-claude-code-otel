import { describe, expect, it } from 'vitest'
import logsFixture from './fixtures/logs.json'
import metricsFixture from './fixtures/metrics.json'
import {
  SESSION_ATTR_KEYS,
  buildDeviceLivenessUpdate,
  buildMetricInserts,
  buildSessionUpserts,
  transformLogs,
  transformMetrics,
  type BatchAccount,
  type MetricRow,
  type OtlpLogsBody,
  type OtlpMetricsBody
} from '../server/utils/otlp'

const metricsBody = metricsFixture as OtlpMetricsBody
const logsBody = logsFixture as OtlpLogsBody

const ACCOUNT_UUID = '11da1661-c0ff-46af-b748-a672c71d09c7'
const ACCOUNT_EMAIL = 'thetechyhub@gmail.com'
const OTHER_ACCOUNT_UUID = '4c8b0d92-77ae-4a1f-9d63-0e2f5a1b8c40'

const DEVICE_ID = '11111111-2222-3333-4444-555555555555'
const OTHER_DEVICE_ID = '99999999-8888-7777-6666-555555555555'
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type AttrHolder = { attributes?: { key: string }[] }

function cloneMetrics(): OtlpMetricsBody {
  return structuredClone(metricsBody)
}

function cloneLogs(): OtlpLogsBody {
  return structuredClone(logsBody)
}

function eachDataPoint(body: OtlpMetricsBody, visit: (point: { attributes?: { key: string }[] }) => void): void {
  for (const resourceMetrics of body.resourceMetrics ?? []) {
    for (const scope of resourceMetrics.scopeMetrics ?? []) {
      for (const metric of scope.metrics ?? []) {
        for (const point of metric.sum?.dataPoints ?? []) visit(point)
      }
    }
  }
}

function eachLogRecord(body: OtlpLogsBody, visit: (record: AttrHolder) => void): void {
  for (const resourceLogs of body.resourceLogs ?? []) {
    for (const scope of resourceLogs.scopeLogs ?? []) {
      for (const record of scope.logRecords ?? []) visit(record)
    }
  }
}

function collect(walk: (visit: (holder: AttrHolder) => void) => void): AttrHolder[] {
  const holders: AttrHolder[] = []
  walk(holder => holders.push(holder))
  return holders
}

function restampAccountAfterFirst(holders: AttrHolder[], uuid: string): void {
  const carrying = holders.filter(holder => holder.attributes?.some(attr => attr.key === 'user.account_uuid'))
  for (const holder of carrying.slice(1)) {
    dropAttr(holder, 'user.account_uuid')
    holder.attributes?.push({ key: 'user.account_uuid', value: { stringValue: uuid } } as never)
  }
}

function dropAttr(holder: { attributes?: { key: string }[] }, key: string): void {
  if (holder.attributes) holder.attributes = holder.attributes.filter(attr => attr.key !== key)
}

function renameDevice(body: OtlpMetricsBody, name: string): OtlpMetricsBody {
  for (const resourceMetrics of body.resourceMetrics ?? []) {
    if (resourceMetrics.resource) {
      dropAttr(resourceMetrics.resource, 'device.name')
      resourceMetrics.resource.attributes?.push({ key: 'device.name', value: { stringValue: name } })
    }
  }
  eachDataPoint(body, (point) => {
    dropAttr(point, 'device.name')
    point.attributes?.push({ key: 'device.name', value: { stringValue: name } } as never)
  })
  return body
}

function expectOk<Row>(result: { ok: true, rows: Row[], sessions: unknown[], account: BatchAccount | null } | { ok: false, error: string }) {
  if (!result.ok) throw new Error(`expected a successful transform, got: ${result.error}`)
  return result
}

function twoPointBody(firstNano: string, secondNano: string): OtlpMetricsBody {
  const point = (timeUnixNano: string) => ({
    attributes: [
      { key: 'device.name', value: { stringValue: 'probe-two' } },
      { key: 'session.id', value: { stringValue: 'sess-1' } },
      { key: 'type', value: { stringValue: 'added' } }
    ],
    startTimeUnixNano: '1787795894906000000',
    timeUnixNano,
    asDouble: 1
  })

  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'device.name', value: { stringValue: 'probe-two' } }] },
      scopeMetrics: [{
        metrics: [{
          name: 'claude_code.lines_of_code.count',
          sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: [point(firstNano), point(secondNano)] }
        }]
      }]
    }]
  }
}

function syntheticRows(count: number): MetricRow[] {
  return Array.from({ length: count }, (_, i) => ({
    dedupeKey: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    ts: new Date(1787795897473),
    deviceId: DEVICE_ID,
    sessionId: 'sess-1',
    metric: 'claude_code.cost.usage',
    model: 'claude-haiku-4-5-20251001',
    value: i,
    attrs: {}
  }))
}

describe('device attribution', () => {
  it('stamps the authenticated device id on every metric and event row', () => {
    const metrics = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID))
    const logs = expectOk(transformLogs(logsBody, DEVICE_ID))

    expect(metrics.rows.length).toBeGreaterThan(0)
    expect(logs.rows.length).toBeGreaterThan(0)
    expect(new Set(metrics.rows.map(row => row.deviceId))).toEqual(new Set([DEVICE_ID]))
    expect(new Set(logs.rows.map(row => row.deviceId))).toEqual(new Set([DEVICE_ID]))
    expect(new Set(metrics.sessions.map(session => session.deviceId))).toEqual(new Set([DEVICE_ID]))
  })

  it('ignores device.name on the wire, so two differently named bodies under one token agree', () => {
    const first = expectOk(transformMetrics(renameDevice(cloneMetrics(), 'work-laptop'), DEVICE_ID))
    const second = expectOk(transformMetrics(renameDevice(cloneMetrics(), 'work-laptip'), DEVICE_ID))

    expect(new Set([...first.rows, ...second.rows].map(row => row.deviceId))).toEqual(new Set([DEVICE_ID]))
    expect(second.rows.map(row => row.metric)).toEqual(first.rows.map(row => row.metric))
  })

  it('gives the same datapoint different dedupe keys under different devices', () => {
    const mine = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID)).rows.map(row => row.dedupeKey)
    const theirs = expectOk(transformMetrics(cloneMetrics(), OTHER_DEVICE_ID)).rows.map(row => row.dedupeKey)

    expect(new Set([...mine, ...theirs]).size).toBe(mine.length + theirs.length)
  })
})

describe('transformMetrics temporality guard', () => {
  it('rejects a non-DELTA batch and names the offending metric', () => {
    const body = cloneMetrics()
    const metric = body.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]
    expect(metric?.sum).toBeDefined()
    if (metric?.sum) metric.sum.aggregationTemporality = 2

    const result = transformMetrics(body, DEVICE_ID)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the CUMULATIVE batch to be rejected')
    expect(result.error).toContain(metric?.name ?? '')
    expect(result.error).toContain('2')
  })

  it('accepts the captured DELTA batch', () => {
    const result = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID))
    expect(result.rows.length).toBe(8)
  })
})

describe('dedupeKey', () => {
  it('is stable across repeated transforms of the same body', () => {
    const first = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID)).rows.map(row => row.dedupeKey)
    const second = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID)).rows.map(row => row.dedupeKey)

    expect(second).toEqual(first)
    for (const key of first) expect(key).toMatch(UUID_SHAPE)
  })

  it('separates two datapoints 300ns apart that share a millisecond', () => {
    const body = twoPointBody('1787795897473000000', '1787795897473000300')
    const rows = expectOk(transformMetrics(body, DEVICE_ID)).rows

    expect(rows).toHaveLength(2)
    expect(rows[0]!.dedupeKey).not.toBe(rows[1]!.dedupeKey)
    expect(rows[0]!.ts.getTime()).toBe(rows[1]!.ts.getTime())
  })
})

describe('attribute promotion and stripping', () => {
  it('keeps promoted and session-constant keys out of metric attrs', () => {
    const result = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID))

    for (const row of result.rows) {
      for (const key of [...SESSION_ATTR_KEYS, 'model', 'session.id', 'device.name']) {
        expect(row.attrs, `metric ${row.metric} still carries ${key}`).not.toHaveProperty(key)
      }
    }
  })

  it('keeps promoted and session-constant keys out of event attrs', () => {
    const result = expectOk(transformLogs(logsBody, DEVICE_ID))

    for (const row of result.rows) {
      for (const key of [...SESSION_ATTR_KEYS, 'model', 'session.id', 'device.name', 'duration_ms']) {
        expect(row.attrs, `event ${row.name} still carries ${key}`).not.toHaveProperty(key)
      }
    }
  })

  it('collects session-constant attributes onto the session row', () => {
    const metricSessions = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID)).sessions
    const logSessions = expectOk(transformLogs(logsBody, DEVICE_ID)).sessions

    for (const session of [...metricSessions, ...logSessions]) {
      expect(session.attrs).toHaveProperty('user.email')
      expect(session.attrs).toHaveProperty('terminal.type')
      expect(session.attrs).toHaveProperty('service.version')
      expect(session.attrs).toHaveProperty('os.type')
    }
  })

  it('folds every datapoint of one session into a single session row', () => {
    const result = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID))
    const sessionIds = new Set(result.rows.map(row => row.sessionId))

    expect(result.rows.length).toBeGreaterThan(result.sessions.length)
    expect(result.sessions).toHaveLength(sessionIds.size)
    expect(new Set(result.sessions.map(session => session.sessionId))).toEqual(sessionIds)
  })

  it('spans a session from its earliest to its latest datapoint', () => {
    const result = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID))
    const session = result.sessions[0]!
    const stamps = result.rows.filter(row => row.sessionId === session.sessionId).map(row => row.ts.getTime())

    expect(session.startedAt.getTime()).toBe(Math.min(...stamps))
    expect(session.lastSeenAt.getTime()).toBe(Math.max(...stamps))
  })
})

describe('transformLogs', () => {
  it('promotes duration_ms as an integer and keeps the prefixed event name', () => {
    const result = expectOk(transformLogs(logsBody, DEVICE_ID))
    const apiRequest = result.rows.find(row => row.name === 'claude_code.api_request')

    expect(apiRequest).toBeDefined()
    expect(apiRequest!.name).toBe('claude_code.api_request')
    expect(apiRequest!.durationMs).toBe(3975)
    expect(Number.isInteger(apiRequest!.durationMs)).toBe(true)
    expect(apiRequest!.model).toBe('claude-haiku-4-5-20251001')
    expect(apiRequest!.deviceId).toBe(DEVICE_ID)
  })

  it('leaves durationMs null on records without the attribute', () => {
    const result = expectOk(transformLogs(logsBody, DEVICE_ID))
    const hook = result.rows.find(row => row.name === 'claude_code.hook_execution_start')

    expect(hook).toBeDefined()
    expect(hook!.durationMs).toBeNull()
  })

  it('keeps non-session resource attributes off the event row', () => {
    const result = expectOk(transformLogs(logsBody, DEVICE_ID))
    for (const row of result.rows) expect(row.attrs).toHaveProperty('device.role')
  })
})

describe('buildMetricInserts', () => {
  it('chunks at 500 rows and restarts placeholder numbering per statement', () => {
    const statements = buildMetricInserts(syntheticRows(1001))

    expect(statements).toHaveLength(3)
    expect(statements.map(statement => statement.params.length)).toEqual([4000, 4000, 8])
    for (const statement of statements) {
      expect(statement.text).toContain('values ($1, $2::timestamptz, $3::uuid, $4, $5, $6, $7, $8::jsonb)')
      expect(statement.text).toContain('on conflict (dedupe_key) do nothing')
      expect(statement.text).toContain('telemetry.metric_point (dedupe_key, ts, device_id, session_id, metric, model, value, attrs)')
    }
    expect(statements[0]!.text).toContain('$4000::jsonb')
  })

  it('emits nothing for an empty row set', () => {
    expect(buildMetricInserts([])).toEqual([])
  })
})

describe('buildSessionUpserts', () => {
  it('carries the device id and folds one session into a single tuple', () => {
    const sessions = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID)).sessions
    const [statement] = buildSessionUpserts(sessions)

    expect(sessions).toHaveLength(1)
    expect(statement!.text).toContain('insert into telemetry.session (session_id, device_id, started_at, last_seen_at, attrs)')
    expect(statement!.text).toContain('values ($1, $2::uuid, $3::timestamptz, $4::timestamptz, $5::jsonb)')
    expect(statement!.params[1]).toBe(DEVICE_ID)
  })

  it('emits nothing for an empty session set', () => {
    expect(buildSessionUpserts([])).toEqual([])
  })
})

describe('buildDeviceLivenessUpdate', () => {
  it('updates the calling device rather than inserting one', () => {
    const rows = expectOk(transformMetrics(cloneMetrics(), DEVICE_ID)).rows
    const [statement] = buildDeviceLivenessUpdate(DEVICE_ID, rows)

    expect(statement!.text).toContain('update telemetry.device set')
    expect(statement!.text).not.toContain('insert into')
    expect(statement!.text).toContain('first_seen = least(coalesce(first_seen, $2::timestamptz), $2::timestamptz)')
    expect(statement!.text).toContain('last_seen_at = greatest(coalesce(last_seen_at, $3::timestamptz), $3::timestamptz)')
    expect(statement!.text).toContain('where id = $1::uuid')
    expect(statement!.params[0]).toBe(DEVICE_ID)
  })

  it('spans the batch from its earliest datapoint to its latest', () => {
    const rows = expectOk(transformMetrics(twoPointBody('1787795897473000000', '1787795894906000000'), DEVICE_ID)).rows
    const [statement] = buildDeviceLivenessUpdate(DEVICE_ID, rows)

    expect(statement!.params[1]).toBe(new Date(1787795894906).toISOString())
    expect(statement!.params[2]).toBe(new Date(1787795897473).toISOString())
  })

  it('emits nothing for an empty batch, so an empty post cannot mark a device as reporting', () => {
    expect(buildDeviceLivenessUpdate(DEVICE_ID, [])).toEqual([])
  })
})

describe('batch account', () => {
  it('surfaces the account the captured metric and log bodies were sent under', () => {
    const account = { uuid: ACCOUNT_UUID, email: ACCOUNT_EMAIL }

    expect(expectOk(transformMetrics(cloneMetrics(), DEVICE_ID)).account).toEqual(account)
    expect(expectOk(transformLogs(cloneLogs(), DEVICE_ID)).account).toEqual(account)
  })

  it('surfaces no account for a batch sent by a signed-out Claude Code', () => {
    const metrics = cloneMetrics()
    eachDataPoint(metrics, point => dropAttr(point, 'user.account_uuid'))
    const logs = cloneLogs()
    eachLogRecord(logs, record => dropAttr(record, 'user.account_uuid'))

    expect(expectOk(transformMetrics(metrics, DEVICE_ID)).account).toBeNull()
    expect(expectOk(transformLogs(logs, DEVICE_ID)).account).toBeNull()
  })

  it('keeps the first account when later records in the same body name another', () => {
    const metrics = cloneMetrics()
    restampAccountAfterFirst(collect(visit => eachDataPoint(metrics, visit)), OTHER_ACCOUNT_UUID)
    const logs = cloneLogs()
    restampAccountAfterFirst(collect(visit => eachLogRecord(logs, visit)), OTHER_ACCOUNT_UUID)

    expect(expectOk(transformMetrics(metrics, DEVICE_ID)).account?.uuid).toBe(ACCOUNT_UUID)
    expect(expectOk(transformLogs(logs, DEVICE_ID)).account?.uuid).toBe(ACCOUNT_UUID)
  })
})

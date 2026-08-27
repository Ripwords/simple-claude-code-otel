import { describe, expect, it } from 'vitest'
import logsFixture from './fixtures/logs.json'
import metricsFixture from './fixtures/metrics.json'
import { UNLABELLED_DEVICE } from '../shared/types'
import {
  SESSION_ATTR_KEYS,
  buildDeviceUpserts,
  buildMetricInserts,
  foldDevices,
  transformLogs,
  transformMetrics,
  type MetricRow,
  type OtlpMetricsBody
} from '../server/utils/otlp'

const metricsBody = metricsFixture as OtlpMetricsBody
const logsBody = logsFixture

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function cloneMetrics(): OtlpMetricsBody {
  return structuredClone(metricsBody)
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

function dropAttr(holder: { attributes?: { key: string }[] }, key: string): void {
  if (holder.attributes) holder.attributes = holder.attributes.filter(attr => attr.key !== key)
}

function expectOk<Row>(result: { ok: true, rows: Row[], sessions: unknown[] } | { ok: false, error: string }) {
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

function earliest(rows: { ts: Date }[]): Date {
  return new Date(Math.min(...rows.map(row => row.ts.getTime())))
}

function syntheticRows(count: number): MetricRow[] {
  return Array.from({ length: count }, (_, i) => ({
    dedupeKey: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    ts: new Date(1787795897473),
    device: 'probe-two',
    sessionId: 'sess-1',
    metric: 'claude_code.cost.usage',
    model: 'claude-haiku-4-5-20251001',
    value: i,
    attrs: {}
  }))
}

describe('resolveDevice', () => {
  it('prefers the resource device.name over the datapoint one', () => {
    const body = cloneMetrics()
    eachDataPoint(body, (point) => {
      dropAttr(point, 'device.name')
      point.attributes?.push({ key: 'device.name', value: { stringValue: 'datapoint-device' } } as never)
    })

    const result = expectOk(transformMetrics(body))
    expect(new Set(result.rows.map(row => row.device))).toEqual(new Set(['probe-two']))
  })

  it('falls back to the datapoint device.name when the resource has none', () => {
    const body = cloneMetrics()
    for (const resourceMetrics of body.resourceMetrics ?? []) {
      if (resourceMetrics.resource) dropAttr(resourceMetrics.resource, 'device.name')
    }
    eachDataPoint(body, (point) => {
      dropAttr(point, 'device.name')
      point.attributes?.push({ key: 'device.name', value: { stringValue: 'datapoint-device' } } as never)
    })

    const result = expectOk(transformMetrics(body))
    expect(new Set(result.rows.map(row => row.device))).toEqual(new Set(['datapoint-device']))
  })

  it('falls back to unknown when neither carries device.name', () => {
    const body = cloneMetrics()
    for (const resourceMetrics of body.resourceMetrics ?? []) {
      if (resourceMetrics.resource) dropAttr(resourceMetrics.resource, 'device.name')
    }
    eachDataPoint(body, point => dropAttr(point, 'device.name'))

    const result = expectOk(transformMetrics(body))
    expect(new Set(result.rows.map(row => row.device))).toEqual(new Set(['unknown']))
  })
})

describe('transformMetrics temporality guard', () => {
  it('rejects a non-DELTA batch and names the offending metric', () => {
    const body = cloneMetrics()
    const metric = body.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]
    expect(metric?.sum).toBeDefined()
    if (metric?.sum) metric.sum.aggregationTemporality = 2

    const result = transformMetrics(body)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the CUMULATIVE batch to be rejected')
    expect(result.error).toContain(metric?.name ?? '')
    expect(result.error).toContain('2')
  })

  it('accepts the captured DELTA batch', () => {
    const result = expectOk(transformMetrics(cloneMetrics()))
    expect(result.rows.length).toBe(8)
  })
})

describe('dedupeKey', () => {
  it('is stable across repeated transforms of the same body', () => {
    const first = expectOk(transformMetrics(cloneMetrics())).rows.map(row => row.dedupeKey)
    const second = expectOk(transformMetrics(cloneMetrics())).rows.map(row => row.dedupeKey)

    expect(second).toEqual(first)
    for (const key of first) expect(key).toMatch(UUID_SHAPE)
  })

  it('separates two datapoints 300ns apart that share a millisecond', () => {
    const body = twoPointBody('1787795897473000000', '1787795897473000300')
    const rows = expectOk(transformMetrics(body)).rows

    expect(rows).toHaveLength(2)
    expect(rows[0]!.dedupeKey).not.toBe(rows[1]!.dedupeKey)
    expect(rows[0]!.ts.getTime()).toBe(rows[1]!.ts.getTime())
  })
})

describe('attribute promotion and stripping', () => {
  it('keeps promoted and session-constant keys out of metric attrs', () => {
    const result = expectOk(transformMetrics(cloneMetrics()))

    for (const row of result.rows) {
      for (const key of [...SESSION_ATTR_KEYS, 'model', 'session.id', 'device.name']) {
        expect(row.attrs, `metric ${row.metric} still carries ${key}`).not.toHaveProperty(key)
      }
    }
  })

  it('keeps promoted and session-constant keys out of event attrs', () => {
    const result = expectOk(transformLogs(logsBody))

    for (const row of result.rows) {
      for (const key of [...SESSION_ATTR_KEYS, 'model', 'session.id', 'device.name', 'duration_ms']) {
        expect(row.attrs, `event ${row.name} still carries ${key}`).not.toHaveProperty(key)
      }
    }
  })

  it('collects session-constant attributes onto the session row', () => {
    const metricSessions = expectOk(transformMetrics(cloneMetrics())).sessions
    const logSessions = expectOk(transformLogs(logsBody)).sessions

    for (const session of [...metricSessions, ...logSessions]) {
      expect(session.attrs).toHaveProperty('user.email')
      expect(session.attrs).toHaveProperty('terminal.type')
      expect(session.attrs).toHaveProperty('service.version')
      expect(session.attrs).toHaveProperty('os.type')
    }
  })

  it('folds every datapoint of one session into a single session row', () => {
    const result = expectOk(transformMetrics(cloneMetrics()))
    const sessionIds = new Set(result.rows.map(row => row.sessionId))

    expect(result.rows.length).toBeGreaterThan(result.sessions.length)
    expect(result.sessions).toHaveLength(sessionIds.size)
    expect(new Set(result.sessions.map(session => session.sessionId))).toEqual(sessionIds)
  })

  it('spans a session from its earliest to its latest datapoint', () => {
    const result = expectOk(transformMetrics(cloneMetrics()))
    const session = result.sessions[0]!
    const stamps = result.rows.filter(row => row.sessionId === session.sessionId).map(row => row.ts.getTime())

    expect(session.startedAt.getTime()).toBe(Math.min(...stamps))
    expect(session.lastSeenAt.getTime()).toBe(Math.max(...stamps))
  })
})

describe('transformLogs', () => {
  it('promotes duration_ms as an integer and keeps the prefixed event name', () => {
    const result = expectOk(transformLogs(logsBody))
    const apiRequest = result.rows.find(row => row.name === 'claude_code.api_request')

    expect(apiRequest).toBeDefined()
    expect(apiRequest!.name).toBe('claude_code.api_request')
    expect(apiRequest!.durationMs).toBe(3975)
    expect(Number.isInteger(apiRequest!.durationMs)).toBe(true)
    expect(apiRequest!.model).toBe('claude-haiku-4-5-20251001')
    expect(apiRequest!.device).toBe('probe-laptop')
  })

  it('leaves durationMs null on records without the attribute', () => {
    const result = expectOk(transformLogs(logsBody))
    const hook = result.rows.find(row => row.name === 'claude_code.hook_execution_start')

    expect(hook).toBeDefined()
    expect(hook!.durationMs).toBeNull()
  })

  it('keeps non-session resource attributes off the event row', () => {
    const result = expectOk(transformLogs(logsBody))
    for (const row of result.rows) expect(row.attrs).toHaveProperty('device.role')
  })
})

describe('buildMetricInserts', () => {
  it('chunks at 500 rows and restarts placeholder numbering per statement', () => {
    const statements = buildMetricInserts(syntheticRows(1001))

    expect(statements).toHaveLength(3)
    expect(statements.map(statement => statement.params.length)).toEqual([4000, 4000, 8])
    for (const statement of statements) {
      expect(statement.text).toContain('values ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::jsonb)')
      expect(statement.text).toContain('on conflict (dedupe_key) do nothing')
      expect(statement.text).toContain('telemetry.metric_point')
    }
    expect(statements[0]!.text).toContain('$4000::jsonb')
  })

  it('emits nothing for an empty row set', () => {
    expect(buildMetricInserts([])).toEqual([])
  })
})

describe('foldDevices', () => {
  it('folds many datapoints of one device into a single entry', () => {
    const result = expectOk(transformMetrics(cloneMetrics()))
    const devices = foldDevices(result.rows)

    expect(result.rows.length).toBeGreaterThan(1)
    expect(devices).toEqual([{ device: 'probe-two', firstSeen: earliest(result.rows) }])
  })

  it('yields one entry per device when a body carries two', () => {
    const body = cloneMetrics()
    const second = structuredClone(body.resourceMetrics![0]!)
    dropAttr(second.resource!, 'device.name')
    second.resource!.attributes!.push({ key: 'device.name', value: { stringValue: 'probe-three' } })
    eachDataPoint({ resourceMetrics: [second] }, (point) => {
      dropAttr(point, 'device.name')
      point.attributes?.push({ key: 'device.name', value: { stringValue: 'probe-three' } } as never)
    })
    body.resourceMetrics!.push(second)

    const devices = foldDevices(expectOk(transformMetrics(body)).rows)

    expect(devices.map(entry => entry.device).sort()).toEqual(['probe-three', 'probe-two'])
  })

  it('keeps the earliest timestamp seen for a device', () => {
    const body = twoPointBody('1787795897473000000', '1787795894906000000')
    const rows = expectOk(transformMetrics(body)).rows
    const devices = foldDevices(rows)

    expect(devices).toHaveLength(1)
    expect(devices[0]!.firstSeen.getTime()).toBe(1787795894906)
    expect(devices[0]!.firstSeen.getTime()).toBeLessThan(rows[0]!.ts.getTime())
  })

  it('yields the unlabelled device when no device.name is set anywhere', () => {
    const body = cloneMetrics()
    for (const resourceMetrics of body.resourceMetrics ?? []) {
      if (resourceMetrics.resource) dropAttr(resourceMetrics.resource, 'device.name')
    }
    eachDataPoint(body, point => dropAttr(point, 'device.name'))

    const devices = foldDevices(expectOk(transformMetrics(body)).rows)

    expect(devices.map(entry => entry.device)).toEqual([UNLABELLED_DEVICE])
  })
})

describe('buildDeviceUpserts', () => {
  it('never writes acknowledged_at and keeps the earliest first_seen on conflict', () => {
    const [statement] = buildDeviceUpserts(foldDevices(expectOk(transformMetrics(cloneMetrics())).rows))

    expect(statement!.text).toContain('insert into telemetry.device (device, first_seen)')
    expect(statement!.text).toContain('first_seen = least(telemetry.device.first_seen, excluded.first_seen)')
    expect(statement!.text).not.toContain('acknowledged_at')
    expect(statement!.params).toEqual(['probe-two', earliest(expectOk(transformMetrics(cloneMetrics())).rows).toISOString()])
  })

  it('emits nothing for an empty device set', () => {
    expect(buildDeviceUpserts([])).toEqual([])
  })
})

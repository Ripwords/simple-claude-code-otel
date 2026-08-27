import type { BreakdownRow, DeviceInfo, DeviceSummary, MetricKey, SeriesPoint } from '#shared/types'

const WORK = '1a7c3e58-9d24-4b61-8f03-2c5e7a9b1d40'
const PERSONAL = '4b2f9d61-7e08-4a35-92c7-6d1b3f8e0a52'
const PENDING = '8c5e1a37-2b96-4d70-a41f-9e07c2b5d863'
const REVOKED = 'd0e4b872-5f13-4c29-b6a8-3a71e9d4c015'

const NAMES: Record<string, string> = {
  [WORK]: 'work-mac',
  [PERSONAL]: 'personal-mac',
  [PENDING]: 'build-box',
  [REVOKED]: 'old-laptop'
}

const REPORTING = [WORK, PERSONAL]

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/**
 * Covers all three lifecycle states at once, so the roster, the pending setup
 * prompt and the revoked treatment can all be built before the devices API
 * lands. Only the two reporting machines carry telemetry, which keeps the
 * default fixture view on the two-machine spine.
 */
export function fixtureDevices(): DeviceInfo[] {
  return [
    {
      id: WORK,
      name: 'work-mac',
      tokenPrefix: '7f2a91c4',
      status: 'reporting',
      createdAt: '2026-06-02T09:02:00.000Z',
      firstSeen: '2026-06-02T09:14:00.000Z',
      lastSeen: '2026-08-27T08:51:00.000Z',
      revokedAt: null,
      sessions: 412
    },
    {
      id: PERSONAL,
      name: 'personal-mac',
      tokenPrefix: 'c481d02e',
      status: 'reporting',
      createdAt: '2026-08-26T18:55:00.000Z',
      firstSeen: '2026-08-26T19:02:00.000Z',
      lastSeen: '2026-08-26T23:40:00.000Z',
      revokedAt: null,
      sessions: 12
    },
    {
      id: PENDING,
      name: 'build-box',
      tokenPrefix: '19be5a77',
      status: 'pending',
      createdAt: '2026-08-27T07:40:00.000Z',
      firstSeen: null,
      lastSeen: null,
      revokedAt: null,
      sessions: 0
    },
    {
      id: REVOKED,
      name: 'old-laptop',
      tokenPrefix: 'a305f6b1',
      status: 'revoked',
      createdAt: '2026-03-11T10:20:00.000Z',
      firstSeen: '2026-03-11T10:33:00.000Z',
      lastSeen: '2026-07-19T16:04:00.000Z',
      revokedAt: '2026-07-20T09:12:00.000Z',
      sessions: 87
    }
  ]
}

export function fixtureSummary(devices: string[]): DeviceSummary[] {
  const rows: DeviceSummary[] = [
    {
      deviceId: WORK,
      device: 'work-mac',
      costUsd: 184.32,
      inputTokens: 2_140_000,
      outputTokens: 486_000,
      cacheReadTokens: 18_900_000,
      cacheCreationTokens: 1_260_000,
      sessions: 128,
      linesAdded: 24_180,
      linesRemoved: 9_640,
      activeSeconds: 151_200,
      toolCalls: 6421,
      toolFailures: 213,
      apiRequests: 4980,
      apiErrors: 61,
      p50ToolMs: 142,
      p95ToolMs: 1830,
      p50ApiMs: 2100,
      p95ApiMs: 9400
    },
    {
      deviceId: PERSONAL,
      device: 'personal-mac',
      costUsd: 47.86,
      inputTokens: 610_000,
      outputTokens: 158_000,
      cacheReadTokens: 4_320_000,
      cacheCreationTokens: 390_000,
      sessions: 39,
      linesAdded: 9310,
      linesRemoved: 2870,
      activeSeconds: 39_600,
      toolCalls: 1584,
      toolFailures: 41,
      apiRequests: 1290,
      apiErrors: 9,
      p50ToolMs: 118,
      p95ToolMs: 1440,
      p50ApiMs: 1870,
      p95ApiMs: 7600
    }
  ]
  return rows.filter(row => devices.length === 0 || devices.includes(row.deviceId))
}

export function fixtureTimeseries(devices: string[], metric: MetricKey, bucket: 'hour' | 'day'): SeriesPoint[] {
  const steps = bucket === 'hour' ? 24 : 30
  const stepMs = bucket === 'hour' ? 3_600_000 : 86_400_000
  const end = Date.now()
  const scale: Record<MetricKey, number> = { cost: 8, tokens: 900_000, linesOfCode: 1400, activeTime: 7200, session: 9, editDecision: 12 }
  const base = scale[metric]
  const points: SeriesPoint[] = []

  for (const deviceId of REPORTING) {
    if (devices.length > 0 && !devices.includes(deviceId)) continue
    const random = seeded(deviceId === WORK ? 7 : 23)
    const weight = deviceId === WORK ? 1 : 0.34
    for (let i = steps - 1; i >= 0; i--) {
      const at = new Date(end - i * stepMs)
      const weekday = at.getDay() !== 0 && at.getDay() !== 6
      const dayFactor = deviceId === WORK ? (weekday ? 1 : 0.15) : (weekday ? 0.5 : 1.4)
      points.push({
        bucket: at.toISOString(),
        deviceId,
        device: NAMES[deviceId]!,
        value: Number((base * weight * dayFactor * (0.55 + random() * 0.9)).toFixed(metric === 'cost' ? 2 : 0))
      })
    }
  }
  return points
}

const BREAKDOWN_KEYS: Record<string, Array<[string, number]>> = {
  model: [['claude-opus-4-8-20260714', 0.62], ['claude-sonnet-4-6-20260212', 0.29], ['claude-haiku-4-5-20251001', 0.09]],
  toolName: [['Edit', 0.28], ['Bash', 0.24], ['Read', 0.21], ['Grep', 0.12], ['Write', 0.09], ['Task', 0.06]],
  tokenType: [['cacheRead', 0.78], ['input', 0.13], ['cacheCreation', 0.06], ['output', 0.03]],
  editDecision: [['accept', 0.86], ['reject', 0.11], ['auto_accept', 0.03]],
  errorStatus: [['429', 0.51], ['529', 0.28], ['500', 0.14], ['400', 0.07]]
}

const BREAKDOWN_TOTALS: Record<string, number> = {
  model: 232,
  toolName: 8005,
  tokenType: 28_464_000,
  editDecision: 3120,
  errorStatus: 70
}

export function fixtureBreakdown(devices: string[], by: string): BreakdownRow[] {
  const keys = BREAKDOWN_KEYS[by] ?? []
  const total = BREAKDOWN_TOTALS[by] ?? 100
  const rows: BreakdownRow[] = []
  for (const deviceId of REPORTING) {
    if (devices.length > 0 && !devices.includes(deviceId)) continue
    const share = deviceId === WORK ? 0.79 : 0.21
    for (const [key, fraction] of keys) {
      rows.push({ deviceId, device: NAMES[deviceId]!, key, value: Number((total * share * fraction).toFixed(by === 'model' ? 2 : 0)) })
    }
  }
  return rows
}

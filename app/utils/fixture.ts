import type { BreakdownRow, DeviceInfo, DeviceSummary, MetricKey, SeriesPoint } from '#shared/types'
import { UNLABELLED_DEVICE } from '#shared/types'

const DEVICES = ['personal-mac', 'work-mac'] as const

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/**
 * Covers all three onboarding states at once, so the notices, the two-device
 * spine, and the unlabelled warning can all be built without waiting on real
 * telemetry from a third machine.
 */
export function fixtureDevices(): DeviceInfo[] {
  return [
    {
      device: 'work-mac',
      firstSeen: '2026-06-02T09:14:00.000Z',
      lastSeen: '2026-08-27T08:51:00.000Z',
      sessions: 412,
      acknowledgedAt: '2026-06-02T09:40:00.000Z',
      isNew: false,
      isUnlabelled: false
    },
    {
      device: 'personal-mac',
      firstSeen: '2026-08-26T19:02:00.000Z',
      lastSeen: '2026-08-26T23:40:00.000Z',
      sessions: 12,
      acknowledgedAt: null,
      isNew: true,
      isUnlabelled: false
    },
    {
      device: UNLABELLED_DEVICE,
      firstSeen: '2026-08-25T11:20:00.000Z',
      lastSeen: '2026-08-27T07:05:00.000Z',
      sessions: 4,
      acknowledgedAt: null,
      isNew: true,
      isUnlabelled: true
    }
  ]
}

export function fixtureSummary(devices: string[]): DeviceSummary[] {
  const rows: DeviceSummary[] = [
    {
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
  return rows.filter(row => devices.length === 0 || devices.includes(row.device))
}

export function fixtureTimeseries(devices: string[], metric: MetricKey, bucket: 'hour' | 'day'): SeriesPoint[] {
  const steps = bucket === 'hour' ? 24 : 30
  const stepMs = bucket === 'hour' ? 3_600_000 : 86_400_000
  const end = Date.now()
  const scale: Record<MetricKey, number> = { cost: 8, tokens: 900_000, linesOfCode: 1400, activeTime: 7200, session: 9, editDecision: 12 }
  const base = scale[metric]
  const points: SeriesPoint[] = []

  for (const device of DEVICES) {
    if (devices.length > 0 && !devices.includes(device)) continue
    const random = seeded(device === 'work-mac' ? 7 : 23)
    const weight = device === 'work-mac' ? 1 : 0.34
    for (let i = steps - 1; i >= 0; i--) {
      const at = new Date(end - i * stepMs)
      const weekday = at.getDay() !== 0 && at.getDay() !== 6
      const dayFactor = device === 'work-mac' ? (weekday ? 1 : 0.15) : (weekday ? 0.5 : 1.4)
      points.push({
        bucket: at.toISOString(),
        device,
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
  for (const device of DEVICES) {
    if (devices.length > 0 && !devices.includes(device)) continue
    const share = device === 'work-mac' ? 0.79 : 0.21
    for (const [key, fraction] of keys) {
      rows.push({ device, key, value: Number((total * share * fraction).toFixed(by === 'model' ? 2 : 0)) })
    }
  }
  return rows
}

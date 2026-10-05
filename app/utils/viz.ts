export interface ChartPoint {
  x: number
  y: number
}

export interface ChartSeries {
  key: string
  label: string
  color: string
  points: ChartPoint[]
}

export interface ChartBar {
  key: string
  label: string
  value: number
  color: string
}

export interface ChartBarGroup {
  label: string
  bars: ChartBar[]
}

export interface Scale {
  (value: number): number
  domain: [number, number]
  range: [number, number]
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  const scale = ((value: number) => {
    if (span === 0) return (r0 + r1) / 2
    return r0 + ((value - d0) / span) * (r1 - r0)
  }) as Scale
  scale.domain = domain
  scale.range = range
  return scale
}

export function niceCeil(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

export function niceTicks(max: number, count = 4): number[] {
  const top = niceCeil(max)
  const step = top / count
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}

export function linePath(points: ChartPoint[], sx: Scale, sy: Scale): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ')
}

export const EM_DASH = '\u2014'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const USD_PRECISE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })

export function formatUsd(value: number): string {
  return value !== 0 && Math.abs(value) < 0.01 ? USD_PRECISE.format(value) : USD.format(value)
}

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: value % 1 === 0 ? 0 : 1 }).format(value)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`
}

export function formatRatio(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH
  return `${formatCompact(value)}${unit}`
}

/** UTC so the server and the client agree; local time would mismatch on hydration. */
export function formatStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return EM_DASH
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}Z`
}

export interface Divergence {
  /** 0 when the right side holds everything, 1 when the left side does, 0.5 at parity. */
  share: number
  dominant: 'left' | 'right' | null
  ratio: string
}

export function divergence(left: number | null, right: number | null): Divergence | null {
  if (left === null || right === null) return null
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  const total = left + right
  if (total <= 0) return null

  const bigger = Math.max(left, right)
  const smaller = Math.min(left, right)

  return {
    share: left / total,
    dominant: left === right ? null : left > right ? 'left' : 'right',
    ratio: smaller > 0 ? `${(bigger / smaller).toFixed(1)}\u00d7` : 'all'
  }
}

export function formatBucket(iso: string, bucket: 'hour' | 'day'): string {
  const date = new Date(iso)
  return bucket === 'hour'
    ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatAxisTick(epochMs: number, bucket: 'hour' | 'day'): string {
  const date = new Date(epochMs)
  return bucket === 'hour'
    ? date.toLocaleTimeString('en-US', { hour: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** One series per x: the sum of every series at that x. */
export function sumSeries(series: readonly ChartSeries[]): ChartPoint[] {
  const totals = new Map<number, number>()
  for (const s of series) {
    for (const p of s.points) totals.set(p.x, (totals.get(p.x) ?? 0) + p.y)
  }
  return [...totals.entries()].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }))
}

export const OTHER_SERIES_KEY = '__other__'

/**
 * Keeps the `limit` series with the largest totals and folds the rest into one "Other" series.
 * The palette has eight hues and a chart stays legible at far fewer, so past that point colour
 * stops identifying anything; one honest "Other" band beats twelve near-identical lines.
 */
export function topSeries(series: readonly ChartSeries[], limit: number, otherColor = 'var(--viz-other)'): ChartSeries[] {
  const total = (s: ChartSeries) => s.points.reduce((sum, p) => sum + p.y, 0)
  const ranked = [...series].filter(s => total(s) > 0).sort((a, b) => total(b) - total(a) || a.label.localeCompare(b.label))
  if (ranked.length <= limit + 1) return ranked

  const kept = ranked.slice(0, limit)
  const rest = ranked.slice(limit)
  return [...kept, { key: OTHER_SERIES_KEY, label: `${rest.length} others`, color: otherColor, points: sumSeries(rest) }]
}

export interface FleetTotal {
  key: string
  total: number
  /** Per machine, largest first, for the hover breakdown. */
  parts: Array<{ deviceId: string, device: string, value: number }>
}

/** Collapses per-machine breakdown rows into one total per key, largest first. */
export function fleetTotals(rows: readonly { deviceId: string, device: string, key: string, value: number }[]): FleetTotal[] {
  const byKey = new Map<string, FleetTotal>()
  for (const row of rows) {
    let entry = byKey.get(row.key)
    if (!entry) {
      entry = { key: row.key, total: 0, parts: [] }
      byKey.set(row.key, entry)
    }
    entry.total += row.value
    entry.parts.push({ deviceId: row.deviceId, device: row.device, value: row.value })
  }
  return [...byKey.values()]
    .filter(entry => entry.total > 0)
    .map(entry => ({ ...entry, parts: entry.parts.sort((a, b) => b.value - a.value) }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
}

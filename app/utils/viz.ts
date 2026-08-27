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

export function areaPath(points: ChartPoint[], sx: Scale, sy: Scale, baseline: number): string {
  if (points.length === 0) return ''
  const first = points[0]!
  const last = points[points.length - 1]!
  return `${linePath(points, sx, sy)} L${sx(last.x).toFixed(2)},${baseline.toFixed(2)} L${sx(first.x).toFixed(2)},${baseline.toFixed(2)} Z`
}

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
  if (value === null || !Number.isFinite(value)) return '--'
  return `${formatCompact(value)}${unit}`
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

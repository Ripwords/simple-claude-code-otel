import type { DeviceSummary } from '#shared/types'

export type MeasureGroup = 'totals' | 'rates'

export interface Measure {
  key: string
  label: string
  group: MeasureGroup
  of: (summary: DeviceSummary) => number | null
  display: (value: number | null) => string
}

function hours(summary: DeviceSummary): number {
  return summary.activeSeconds / 3600
}

function perHour(summary: DeviceSummary, amount: number): number | null {
  return summary.activeSeconds > 0 ? amount / hours(summary) : null
}

export const MEASURES: Measure[] = [
  { key: 'cost', label: 'Cost', group: 'totals', of: s => s.costUsd, display: v => v === null ? EM_DASH : formatUsd(v) },
  { key: 'sessions', label: 'Sessions', group: 'totals', of: s => s.sessions, display: v => v === null ? EM_DASH : formatCount(v) },
  { key: 'active', label: 'Active time', group: 'totals', of: s => s.activeSeconds, display: v => v === null ? EM_DASH : formatDuration(v) },
  { key: 'added', label: 'Lines added', group: 'totals', of: s => s.linesAdded, display: v => v === null ? EM_DASH : formatCount(v) },
  { key: 'removed', label: 'Lines removed', group: 'totals', of: s => s.linesRemoved, display: v => v === null ? EM_DASH : formatCount(v) },
  { key: 'toolCalls', label: 'Tool calls', group: 'totals', of: s => s.toolCalls, display: v => v === null ? EM_DASH : formatCount(v) },
  {
    key: 'costPerHour',
    label: 'Cost per active hour',
    group: 'rates',
    of: s => perHour(s, s.costUsd),
    display: v => v === null ? EM_DASH : `${formatUsd(v)}/h`
  },
  {
    key: 'linesPerHour',
    label: 'Lines added per hour',
    group: 'rates',
    of: s => perHour(s, s.linesAdded),
    display: v => v === null ? EM_DASH : `${formatCompact(v)}/h`
  },
  {
    key: 'toolsPerSession',
    label: 'Tool calls per session',
    group: 'rates',
    of: s => s.sessions > 0 ? s.toolCalls / s.sessions : null,
    display: v => v === null ? EM_DASH : `${formatCompact(v)}/session`
  },
  {
    key: 'errorRate',
    label: 'API error rate',
    group: 'rates',
    of: s => s.apiRequests > 0 ? (s.apiErrors / s.apiRequests) * 100 : null,
    display: v => v === null ? EM_DASH : `${v.toFixed(1)}%`
  }
]

export const MEASURE_GROUPS: Array<{ id: MeasureGroup, label: string, caption?: string }> = [
  { id: 'totals', label: 'Totals' },
  { id: 'rates', label: 'Per unit of work', caption: 'Normalised, so a machine you use more does not automatically win' }
]

export function measuresIn(group: MeasureGroup): Measure[] {
  return MEASURES.filter(measure => measure.group === group)
}

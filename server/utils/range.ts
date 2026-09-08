import { z } from 'zod'
import type { H3Event } from 'h3'
import type { Bucket } from '#shared/types'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_MS = 7 * DAY_MS
const MAX_RANGE_MS = 400 * DAY_MS
const HOURLY_BUCKET_LIMIT_MS = 3 * DAY_MS
const DEFAULT_RAW_RETENTION_DAYS = 7

const timestamp = z.union([z.iso.datetime({ offset: true }), z.iso.date()])

const deviceIds = z
  .string()
  .transform(raw => [...new Set(raw.split(',').map(id => id.trim()).filter(Boolean))])
  .pipe(z.array(z.uuid()))

const rangeSchema = z.object({
  from: timestamp.optional(),
  to: timestamp.optional(),
  devices: deviceIds.optional()
})

export interface ResolvedRange {
  from: string
  to: string
  devices: string[] | null
  bucket: Bucket
  /** 'raw' reads only the fact tables; 'split' reads rollups up to the seam and raw after it. */
  source: 'raw' | 'split'
  /** Start of today in UTC. Rollups hold complete days strictly before it, raw holds the rest. */
  seam: string
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

export function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

export function rawRetentionDays(config: { rawRetentionDays?: unknown }): number {
  return positiveInt(config.rawRetentionDays, DEFAULT_RAW_RETENTION_DAYS)
}

/**
 * Resolves the window and decides where it is read from. Two boundaries do separate jobs and
 * must not be conflated:
 *
 * - `seam`, start of today UTC, splits rollup from raw. Because rollups only ever hold complete
 *   days, splitting here makes double counting structurally impossible even though raw and
 *   rollup overlap for the whole retention window.
 * - the raw floor decides only whether hour buckets are available, never where the split falls.
 *
 * A range served from rollups is snapped to UTC midnight, because a daily rollup row is
 * indivisible: an unsnapped `from` would have to either include hours it should not or drop
 * hours it should, which on a seven-day range is up to a full day of error.
 */
export function parseRange(event: H3Event, now = Date.now()): ResolvedRange {
  const parsed = rangeSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range query', data: z.treeifyError(parsed.error) })
  }

  const { from, to, devices } = parsed.data
  let toMs = to ? Date.parse(to) : now
  let fromMs = from ? Date.parse(from) : toMs - DEFAULT_RANGE_MS

  if (fromMs >= toMs) {
    throw createError({ statusCode: 400, statusMessage: '`from` must be earlier than `to`' })
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    throw createError({ statusCode: 400, statusMessage: 'Range must not exceed 400 days' })
  }

  const retentionDays = rawRetentionDays(useRuntimeConfig())
  const rawFloor = now - retentionDays * DAY_MS
  const servedFromRaw = toMs - fromMs < HOURLY_BUCKET_LIMIT_MS && fromMs >= rawFloor

  if (!servedFromRaw) {
    fromMs = startOfUtcDay(fromMs)
    toMs = Math.ceil(toMs / DAY_MS) * DAY_MS
  }

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    devices: devices?.length ? devices : null,
    bucket: servedFromRaw ? 'hour' : 'day',
    source: servedFromRaw ? 'raw' : 'split',
    seam: new Date(startOfUtcDay(now)).toISOString()
  }
}

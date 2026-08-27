import { z } from 'zod'
import type { H3Event } from 'h3'
import type { Bucket } from '#shared/types'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_MS = 7 * DAY_MS
const MAX_RANGE_MS = 400 * DAY_MS
const HOURLY_BUCKET_LIMIT_MS = 3 * DAY_MS

const timestamp = z.union([z.iso.datetime({ offset: true }), z.iso.date()])

const rangeSchema = z.object({
  from: timestamp.optional(),
  to: timestamp.optional(),
  devices: z.string().optional()
})

export interface ResolvedRange {
  from: string
  to: string
  devices: string[] | null
}

export function parseRange(event: H3Event): ResolvedRange {
  const parsed = rangeSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid range query', data: z.treeifyError(parsed.error) })
  }

  const { from, to, devices } = parsed.data
  const toMs = to ? Date.parse(to) : Date.now()
  const fromMs = from ? Date.parse(from) : toMs - DEFAULT_RANGE_MS

  if (fromMs >= toMs) {
    throw createError({ statusCode: 400, statusMessage: '`from` must be earlier than `to`' })
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    throw createError({ statusCode: 400, statusMessage: 'Range must not exceed 400 days' })
  }

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    devices: parseDevices(devices)
  }
}

export function defaultBucket(range: ResolvedRange): Bucket {
  return Date.parse(range.to) - Date.parse(range.from) < HOURLY_BUCKET_LIMIT_MS ? 'hour' : 'day'
}

function parseDevices(raw: string | undefined): string[] | null {
  if (!raw) return null
  const list = [...new Set(raw.split(',').map(device => device.trim()).filter(Boolean))]
  return list.length > 0 ? list : null
}

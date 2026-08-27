import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

export function requireBearer(event: H3Event, expected: string): void {
  // An unset token must fail closed. Falling through would authenticate every caller.
  if (!expected) throw createError({ statusCode: 500, statusMessage: 'INGEST_TOKEN is not configured' })

  const header = getRequestHeader(event, 'authorization')
  if (!header?.startsWith('Bearer ')) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  const wanted = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(presented, wanted)) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
}

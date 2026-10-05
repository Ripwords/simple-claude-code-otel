import { requireSession } from '../../utils/session'
import { z } from 'zod'
import { METRICS } from '#shared/types'
import type { MetricKey } from '#shared/types'
import { parseRange } from '../../utils/range'
import { queryTimeseries } from '../../utils/queries'

const metricKeys = Object.keys(METRICS) as MetricKey[]

const paramsSchema = z.object({ metric: z.enum(metricKeys) })

export default defineEventHandler(async (event) => {
  requireSession(event)
  const range = parseRange(event)
  const parsed = paramsSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid timeseries query', data: z.treeifyError(parsed.error) })
  }

  // The bucket follows from where the range is read, so it is decided in parseRange rather
  // than taken from the caller. Honouring a client-supplied `bucket=hour` over a 400-day
  // range would quietly return only the days still held raw.
  return await queryTimeseries(range, parsed.data.metric, range.bucket)
})

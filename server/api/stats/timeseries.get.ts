import { z } from 'zod'
import { METRICS } from '#shared/types'
import type { MetricKey } from '#shared/types'
import { defaultBucket, parseRange } from '../../utils/range'
import { queryTimeseries } from '../../utils/queries'

const metricKeys = Object.keys(METRICS) as MetricKey[]

const paramsSchema = z.object({
  metric: z.enum(metricKeys),
  bucket: z.enum(['hour', 'day']).optional()
})

export default defineEventHandler(async (event) => {
  const range = parseRange(event)
  const parsed = paramsSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid timeseries query', data: z.treeifyError(parsed.error) })
  }

  return await queryTimeseries(range, parsed.data.metric, parsed.data.bucket ?? defaultBucket(range))
})

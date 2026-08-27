import { z } from 'zod'
import { parseRange } from '../../utils/range'
import { BREAKDOWN_KEYS, queryBreakdown } from '../../utils/queries'

const paramsSchema = z.object({ by: z.enum(BREAKDOWN_KEYS) })

export default defineEventHandler(async (event) => {
  const range = parseRange(event)
  const parsed = paramsSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid breakdown query', data: z.treeifyError(parsed.error) })
  }

  return await queryBreakdown(range, parsed.data.by)
})

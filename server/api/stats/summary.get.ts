import { requireSession } from '../../utils/session'
import { parseRange } from '../../utils/range'
import { querySummary } from '../../utils/queries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  return await querySummary(parseRange(event))
})

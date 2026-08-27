import { parseRange } from '../../utils/range'
import { querySummary } from '../../utils/queries'

export default defineEventHandler(async (event) => {
  return await querySummary(parseRange(event))
})

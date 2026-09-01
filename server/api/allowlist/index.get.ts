import { requireSession } from '../../utils/session'
import { listAllowedEmails } from '../../utils/allowlistQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  return await listAllowedEmails()
})

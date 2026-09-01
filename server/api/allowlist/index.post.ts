import { requireSession } from '../../utils/session'
import { addAllowedEmail, parseAllowedEmail } from '../../utils/allowlistQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const email = parseAllowedEmail(await readBody(event))
  return await addAllowedEmail(email)
})

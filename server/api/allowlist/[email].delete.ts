import { requireSession } from '../../utils/session'
import { parseEmailParam, removeAllowedEmail } from '../../utils/allowlistQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const email = parseEmailParam(decoded(getRouterParam(event, 'email')))
  await removeAllowedEmail(email)
  return { email }
})

// Malformed percent-encoding throws, and it should land as the same 400 any other
// unusable address gets rather than escaping the handler as a 500.
function decoded(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

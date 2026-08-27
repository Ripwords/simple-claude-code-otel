import { z } from 'zod'
import { issueSession, verifyPassword } from '../../utils/session'

const body = z.object({ password: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const { password } = body.parse(await readBody(event))
  const { dashboardPasswordHash, sessionSecret } = useRuntimeConfig(event)

  const hash = String(dashboardPasswordHash ?? '')
  const secret = String(sessionSecret ?? '')
  if (!hash || !secret) {
    throw createError({ statusCode: 503, statusMessage: 'Dashboard password is not configured' })
  }

  if (!await verifyPassword(password, hash)) {
    throw createError({ statusCode: 401, statusMessage: 'Wrong password' })
  }

  issueSession(event, secret)
  return { ok: true }
})

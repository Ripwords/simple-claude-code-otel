import { hasSession } from '../../utils/session'

export default defineEventHandler((event) => {
  const { sessionSecret, dashboardPasswordHash } = useRuntimeConfig(event)
  return {
    signedIn: hasSession(event, String(sessionSecret ?? '')),
    configured: Boolean(String(dashboardPasswordHash ?? ''))
  }
})

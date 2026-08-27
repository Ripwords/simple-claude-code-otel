import { endSession } from '../../utils/session'

export default defineEventHandler((event) => {
  endSession(event)
  return { ok: true }
})

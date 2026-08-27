import { requireSession } from '../../utils/session'
import { listDevices } from '../../utils/deviceQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  return await listDevices()
})

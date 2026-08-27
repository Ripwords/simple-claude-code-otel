import { requireSession } from '../../../utils/session'
import { parseDeviceId, releaseDevice } from '../../../utils/deviceQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = parseDeviceId(getRouterParam(event, 'id'))
  return await releaseDevice(id)
})

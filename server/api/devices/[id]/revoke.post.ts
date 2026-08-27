import { requireSession } from '../../../utils/session'
import { parseDeviceId, revokeDevice } from '../../../utils/deviceQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = parseDeviceId(getRouterParam(event, 'id'))
  return await revokeDevice(id)
})

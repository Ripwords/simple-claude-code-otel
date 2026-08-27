import { requireSession } from '../../utils/session'
import { deleteDevice, parseDeviceId } from '../../utils/deviceQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = parseDeviceId(getRouterParam(event, 'id'))
  return await deleteDevice(id)
})

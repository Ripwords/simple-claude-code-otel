import { requireSession } from '../../utils/session'
import { parseDeviceId, parseDeviceName, renameDevice } from '../../utils/deviceQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = parseDeviceId(getRouterParam(event, 'id'))
  const name = parseDeviceName(await readBody(event))
  return await renameDevice(id, name)
})

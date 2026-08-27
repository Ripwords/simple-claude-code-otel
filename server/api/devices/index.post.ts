import { requireSession } from '../../utils/session'
import { createDevice, parseDeviceName } from '../../utils/deviceQueries'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const name = parseDeviceName(await readBody(event))
  const created = await createDevice(name)
  setResponseStatus(event, 201)
  return created
})

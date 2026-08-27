import { parseRange } from '../../utils/range'
import { queryDevices } from '../../utils/queries'

export default defineEventHandler(async (event) => {
  const { devices } = parseRange(event)
  return await queryDevices(devices)
})

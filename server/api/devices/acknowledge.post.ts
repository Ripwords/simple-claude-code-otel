import { z } from 'zod'
import { acknowledgeDevice } from '../../utils/queries'

const bodySchema = z.object({
  device: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid body', data: z.treeifyError(parsed.error) })
  }

  const device = await acknowledgeDevice(parsed.data.device)
  if (!device) throw createError({ statusCode: 404, statusMessage: 'Unknown device' })

  return device
})

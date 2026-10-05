import { buildDeviceLivenessUpdate, buildMetricInserts, buildSessionUpserts, transformMetrics, type OtlpMetricsBody } from '../../../utils/otlp'
import { authenticateDevice, enforceDeviceAccount } from '../../../utils/deviceToken'
import { ingest } from '../../../utils/ingest'

export default defineEventHandler(async (event) => {
  const device = await authenticateDevice(getRequestHeader(event, 'authorization'))

  const body = await readBody<OtlpMetricsBody>(event)
  const result = transformMetrics(body, device.id)
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: result.error })

  await enforceDeviceAccount(device, result.account)

  const statements = [
    ...buildSessionUpserts(result.sessions),
    ...buildMetricInserts(result.rows),
    ...buildDeviceLivenessUpdate(device.id, result.seenAt)
  ]

  return await ingest(event, statements, {
    accepted: result.rows.length + result.dropped,
    stored: result.rows.length,
    dropped: result.dropped
  })
})

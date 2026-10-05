import { buildDeviceLivenessUpdate, buildEventInserts, buildSessionUpserts, transformLogs, type OtlpLogsBody } from '../../../utils/otlp'
import { authenticateDevice, enforceDeviceAccount } from '../../../utils/deviceToken'
import { ingest } from '../../../utils/ingest'

export default defineEventHandler(async (event) => {
  const device = await authenticateDevice(getRequestHeader(event, 'authorization'))

  const body = await readBody<OtlpLogsBody>(event)
  const result = transformLogs(body, device.id)
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: result.error })

  await enforceDeviceAccount(device, result.account)

  // Liveness spans every record the batch carried, not just the stored ones, so a machine
  // sending only unstored events still reads as reporting rather than gone quiet.
  const statements = [
    ...buildSessionUpserts(result.sessions),
    ...buildEventInserts(result.rows),
    ...buildDeviceLivenessUpdate(device.id, result.seenAt)
  ]

  return await ingest(statements, {
    accepted: result.rows.length + result.dropped,
    stored: result.rows.length,
    dropped: result.dropped
  })
})

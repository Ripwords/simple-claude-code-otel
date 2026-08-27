import { buildDeviceLivenessUpdate, buildEventInserts, buildSessionUpserts, transformLogs, type OtlpLogsBody } from '../../../utils/otlp'
import { authenticateDevice, enforceDeviceAccount } from '../../../utils/deviceToken'

export default defineEventHandler(async (event) => {
  const device = await authenticateDevice(getRequestHeader(event, 'authorization'))

  const body = await readBody<OtlpLogsBody>(event)
  const result = transformLogs(body, device.id)
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: result.error })

  await enforceDeviceAccount(device, result.account)

  const statements = [
    ...buildSessionUpserts(result.sessions),
    ...buildEventInserts(result.rows),
    ...buildDeviceLivenessUpdate(device.id, result.rows)
  ]
  if (statements.length > 0) {
    const sql = db()
    await sql.transaction(statements.map(statement => sql.query(statement.text, statement.params)))
  }

  return { accepted: result.rows.length }
})

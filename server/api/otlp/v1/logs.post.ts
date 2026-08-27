import { buildDeviceUpserts, buildEventInserts, buildSessionUpserts, foldDevices, transformLogs, type OtlpLogsBody } from '../../../utils/otlp'
import { requireBearer } from '../../../utils/ingestAuth'

export default defineEventHandler(async (event) => {
  requireBearer(event, useRuntimeConfig().ingestToken)

  const body = await readBody<OtlpLogsBody>(event)
  const result = transformLogs(body)
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: result.error })

  const statements = [
    ...buildDeviceUpserts(foldDevices(result.rows)),
    ...buildSessionUpserts(result.sessions),
    ...buildEventInserts(result.rows)
  ]
  if (statements.length > 0) {
    const sql = db()
    await sql.transaction(statements.map(statement => sql.query(statement.text, statement.params)))
  }

  return { accepted: result.rows.length }
})

import { buildMetricInserts, buildSessionUpserts, transformMetrics, type OtlpMetricsBody } from '../../../utils/otlp'
import { requireBearer } from '../../../utils/ingestAuth'

export default defineEventHandler(async (event) => {
  requireBearer(event, useRuntimeConfig().ingestToken)

  const body = await readBody<OtlpMetricsBody>(event)
  const result = transformMetrics(body)
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: result.error })

  const statements = [...buildSessionUpserts(result.sessions), ...buildMetricInserts(result.rows)]
  if (statements.length > 0) {
    const sql = db()
    await sql.transaction(statements.map(statement => sql.query(statement.text, statement.params)))
  }

  return { accepted: result.rows.length }
})

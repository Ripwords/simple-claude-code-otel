import type { Statement } from './otlp'
import { db } from './db'

export interface IngestResult {
  accepted: number
  stored: number
  dropped: number
}

// Neon refuses writes once the project is over its storage plan. The OTLP exporter retries a
// 5xx, so failing loudly here turns a full database into a retry storm that also starves the
// dashboard of connections. Shedding the batch keeps the site up; the cron's size alarm is
// what tells someone the data is being lost.
const OVER_CAPACITY = /project size limit|disk quota|no space left/i

export async function runIngest(statements: Statement[], result: IngestResult): Promise<IngestResult> {
  if (statements.length === 0) return result

  try {
    const sql = db()
    await sql.transaction(statements.map(statement => sql.query(statement.text, statement.params)))
    return result
  } catch (error) {
    if (!OVER_CAPACITY.test(String((error as Error)?.message ?? ''))) throw error
    console.error('[ingest] shedding batch: database is over its storage limit', error)
    return { accepted: result.accepted, stored: 0, dropped: result.accepted }
  }
}

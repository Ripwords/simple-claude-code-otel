import { waitUntil } from '@vercel/functions'
import type { Statement } from './otlp'
import { db } from './db'
import { enqueue, flush, redis } from './buffer'

export interface IngestResult {
  accepted: number
  stored: number
  dropped: number
}

// Neon refuses writes once the project is over its storage plan. The OTLP exporter retries a
// 5xx, so failing loudly here turns a full database into a retry storm that also starves the
// dashboard of connections. Shedding the batch keeps the site up; the cron's size alarm is
// what tells someone the data is being lost.
export const OVER_CAPACITY = /project size limit|disk quota|no space left/i

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

/**
 * Parks the batch in Redis when one is configured and kicks off a flush once one is due,
 * after the response so the exporter is not kept waiting on Postgres. Without Redis, or when
 * Redis refuses, it writes straight through.
 */
export async function ingest(statements: Statement[], result: IngestResult): Promise<IngestResult> {
  const store = redis()
  if (!store || statements.length === 0) return await runIngest(statements, result)

  let due: boolean
  try {
    due = await enqueue(store, statements)
  } catch (error) {
    // Redis down or over its monthly quota. Writing straight through wakes the database, but
    // refusing would make the exporter retry and then drop the batch: data lost for a quota.
    console.error('[ingest] Redis unavailable, writing straight to Postgres', error)
    return await runIngest(statements, result)
  }
  if (due) {
    const flushing = flush().catch(error => console.error('[ingest] flush failed; the queue is kept for the next one', error))
    // Nitro's event.waitUntil only forwards to a platform hook its Vercel Node runtime never
    // installs, so on Vercel it would let the instance freeze mid-flush. This one reaches
    // Vercel's request context directly, and off Vercel the promise simply runs on.
    waitUntil(flushing)
  }
  return result
}

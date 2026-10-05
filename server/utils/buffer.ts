import { Redis } from '@upstash/redis'
import type { Statement } from './otlp'
import { db } from './db'
import { OVER_CAPACITY } from './ingest'

/**
 * Ingest is parked in Redis and written to Postgres in bulk, because Neon bills compute for
 * every minute the database is awake and only suspends after five idle minutes. Claude Code
 * posts telemetry every few seconds while anyone is working, which kept the free-tier database
 * awake around twenty hours a day and exhausted the month's compute in three weeks. Batching
 * the writes lets it sleep between flushes.
 *
 * Replaying a batch is always safe: every statement ingest builds is idempotent (dedupe-key
 * inserts, greatest/least upserts), so at-least-once delivery from the queue is enough.
 */

const QUEUE = 'ingest:queue'
const INFLIGHT = 'ingest:inflight'
const LOCK = 'ingest:flush-lock'
const RECENT = 'ingest:flushed-recently'
const DEAD = 'ingest:dead'
const DEAD_KEEP = 1000

export const FLUSH_INTERVAL_SECONDS = 30 * 60
const LOCK_SECONDS = 5 * 60
const PAGE = 50
const WAIT_MS = 8000
const POLL_MS = 300

// One round trip per request: park the batch and report whether a flush is overdue.
const ENQUEUE = `
redis.call('RPUSH', KEYS[1], ARGV[1])
return redis.call('EXISTS', KEYS[2])`

// Resume an interrupted flush before starting a new one, so a crash mid-flush never strands
// the half-written page behind fresher data.
const CLAIM = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 1 end
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('RENAME', KEYS[1], KEYS[2])
  return 1
end
return 0`

// The trim and the unlock only happen while this flush still owns the lock. A flush that was
// frozen past the lock's expiry would otherwise trim by position a page a newer flush had
// already trimmed, deleting batches nobody wrote, and then release the newer flush's lock.
const TRIM_IF_OWNER = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('LTRIM', KEYS[2], tonumber(ARGV[2]), -1)
return 1`

const UNLOCK_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`

let client: Redis | null | undefined

/** Null when no Redis is configured, in which case ingest writes straight to Postgres. */
export function redis(): Redis | null {
  if (client === undefined) {
    const { redisUrl, redisToken } = useRuntimeConfig()
    client = redisUrl && redisToken
      ? new Redis({ url: String(redisUrl), token: String(redisToken), automaticDeserialization: false })
      : null
  }
  return client
}

/** Parks one batch. Resolves true when the caller should start a flush. */
export async function enqueue(store: Redis, statements: Statement[]): Promise<boolean> {
  const recent = await store.eval(ENQUEUE, [QUEUE, RECENT], [JSON.stringify(statements)])
  return Number(recent) === 0
}

export interface FlushResult {
  flushed: number
  /** Batches the database refused, now on the dead-letter list rather than lost. */
  dropped: number
  skipped: boolean
}

/**
 * Drains the queue into Postgres. Only one flush runs at a time; with `wait`, a caller that
 * needs fresh data (the dashboard, the cron) waits for a running flush to finish rather than
 * reading around it.
 */
export async function flush(options: { wait?: boolean } = {}): Promise<FlushResult> {
  const store = redis()
  if (!store) return { flushed: 0, dropped: 0, skipped: true }

  const owner = crypto.randomUUID()
  if (!await store.set(LOCK, owner, { nx: true, ex: LOCK_SECONDS })) {
    if (options.wait) await waitForUnlock(store)
    return { flushed: 0, dropped: 0, skipped: true }
  }

  const result: FlushResult = { flushed: 0, dropped: 0, skipped: false }
  try {
    await store.set(RECENT, '1', { ex: FLUSH_INTERVAL_SECONDS })
    // Two passes: the first may only finish an interrupted flush, and the second then takes
    // whatever queued behind it, so a resumed flush still leaves the queue empty.
    for (let pass = 0; pass < 2; pass++) {
      if (Number(await store.eval(CLAIM, [QUEUE, INFLIGHT], [])) === 0) break
      for (;;) {
        const page = await store.lrange<string>(INFLIGHT, 0, PAGE - 1)
        if (page.length === 0) break
        const batches = page.map(item => JSON.parse(item) as Statement[])
        const dead = await writePage(batches)
        if (dead.length > 0) {
          await store.lpush(DEAD, ...dead.map(batch => JSON.stringify(batch)))
          await store.ltrim(DEAD, 0, DEAD_KEEP - 1)
        }
        if (Number(await store.eval(TRIM_IF_OWNER, [LOCK, INFLIGHT], [owner, String(page.length)])) === 0) {
          // Lost the lock: another flush owns the queue now and will finish this page itself.
          return result
        }
        result.flushed += batches.length
        result.dropped += dead.length
      }
    }
    return result
  } finally {
    await store.eval(UNLOCK_IF_OWNER, [LOCK], [owner])
  }
}

async function waitForUnlock(store: Redis): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline && await store.exists(LOCK)) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

/**
 * Writes a page in one transaction, falling back to one transaction per batch when that fails
 * on the batch itself. A batch can turn unwritable while it waits -- its machine deleted, so the
 * foreign key refuses it, or a deploy changed the schema its SQL was written against -- and
 * without the fallback that one batch would block the queue forever. A connection failure is
 * different: it is rethrown, and the page stays queued for next time.
 * Returns the batches the database refused, for the dead-letter list.
 */
async function writePage(batches: Statement[][]): Promise<Statement[][]> {
  try {
    await transaction(batches.flat())
    return []
  } catch (error) {
    if (!isPoison(error)) throw error
  }

  const dead: Statement[][] = []
  for (const statements of batches) {
    try {
      await transaction(statements)
    } catch (error) {
      if (!isPoison(error)) throw error
      dead.push(statements)
      console.error('[buffer] moving a batch the database refused to the dead-letter list', error)
    }
  }
  return dead
}

async function transaction(statements: Statement[]): Promise<void> {
  if (statements.length === 0) return
  const sql = db()
  await sql.transaction(statements.map(statement => sql.query(statement.text, statement.params)))
}

// Data (22), integrity (23) and syntax-or-schema (42) errors fail the same way on every retry,
// so retrying them would wedge the queue. Over-capacity is set aside too, as direct ingest
// already sheds it. Anything else -- a dropped connection, a suspended endpoint -- is transient.
function isPoison(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'string' && /^(22|23|42)/.test(code)) return true
  return OVER_CAPACITY.test(String((error as Error)?.message ?? ''))
}

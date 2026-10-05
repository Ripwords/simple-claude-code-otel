import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { buildDayRollup, buildRawPrune, buildRollupPrune } from '../../utils/rollup'
import { positiveInt, rawRetentionDays } from '../../utils/range'
import { bearerToken } from '../../utils/deviceToken'
import { db } from '../../utils/db'
import { flush } from '../../utils/buffer'

const DEFAULT_ROLLUP_RETENTION_DAYS = 400
const DEFAULT_SIZE_ALARM_BYTES = 400 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

function isCronRequest(event: H3Event, secret: string): boolean {
  if (getRequestHeader(event, 'x-vercel-cron')) return true

  const presented = bearerToken(getRequestHeader(event, 'authorization'))
  // An unset secret must fail closed; without this an empty token would match an empty config.
  if (!presented || !secret) return false

  return timingSafeEqual(
    createHash('sha256').update(presented).digest(),
    createHash('sha256').update(secret).digest()
  )
}

/** Every complete UTC day still held raw, newest first. */
function daysToRoll(rawRetention: number, now: number): string[] {
  const today = Math.floor(now / DAY_MS) * DAY_MS
  return Array.from({ length: rawRetention }, (_, i) => new Date(today - (i + 1) * DAY_MS).toISOString().slice(0, 10))
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!isCronRequest(event, String(config.cronSecret ?? ''))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const rawRetention = rawRetentionDays(config)
  const rollupRetention = positiveInt(config.rollupRetentionDays, DEFAULT_ROLLUP_RETENTION_DAYS)
  const sizeAlarmBytes = positiveInt(config.sizeAlarmBytes, DEFAULT_SIZE_ALARM_BYTES)

  const sql = db()
  const run = async (text: string, params: unknown[]): Promise<number> => {
    const rows = await sql.query(`with d as (${text} returning 1) select count(*)::int as affected from d`, params)
    return Number(rows[0]?.affected ?? 0)
  }

  // Drain the ingest buffer first, or the rollup would summarise days that are still
  // missing whatever was parked in Redis.
  const buffered = await flush({ wait: true })

  // Roll up before deleting. A day is re-rolled for as long as its raw rows survive, so a
  // laptop that was offline and posts a backlog gets folded in on the next run; deleting
  // first would destroy those rows before anything counted them.
  const days = daysToRoll(rawRetention, Date.now())
  for (const day of days) {
    const statements = buildDayRollup(day)
    await sql.transaction(statements.map(statement => sql.query(statement.text, statement.params)))
  }

  let metricPoints = 0
  let events = 0
  for (const statement of buildRawPrune(rawRetention)) {
    const affected = await run(statement.text, statement.params)
    if (statement.text.includes('metric_point')) metricPoints = affected
    else events = affected
  }

  let rollupRows = 0
  let sessions = 0
  for (const statement of buildRollupPrune(rollupRetention)) {
    const affected = await run(statement.text, statement.params)
    if (statement.text.includes('telemetry.session')) sessions = affected
    else rollupRows += affected
  }

  // Only a device that has stopped mattering is retired: revoked, or provisioned and never
  // used. A machine that is still reporting keeps its row however old its telemetry gets, and
  // the window is measured from revocation rather than creation so a just-revoked device does
  // not vanish. The rollup tables count as surviving telemetry alongside the raw ones.
  const devices = await run(
    'delete from telemetry.device d'
    + ' where (d.revoked_at is not null or d.first_seen is null)'
    + ' and coalesce(d.revoked_at, d.created_at) < now() - make_interval(days => $1::int)'
    + ' and not exists (select 1 from telemetry.session s where s.device_id = d.id)'
    + ' and not exists (select 1 from telemetry.metric_point m where m.device_id = d.id)'
    + ' and not exists (select 1 from telemetry.event e where e.device_id = d.id)'
    + ' and not exists (select 1 from telemetry.metric_daily r where r.device_id = d.id)'
    + ' and not exists (select 1 from telemetry.event_daily r where r.device_id = d.id)',
    [rollupRetention]
  )

  // Deliberately an alarm, not a control loop. pg_database_size does not fall after a delete
  // -- dead tuples go back to the free space map, not the filesystem -- so a job that shrank
  // its own retention until the number moved would read the same size after every pass and
  // walk straight to its floor, destroying history to fix nothing. A healthy steady state is
  // a plateau, and a plateau is indistinguishable from failure through this sensor.
  const sizeRows = await sql.query('select pg_database_size(current_database())::bigint as bytes', [])
  const sizeBytes = Number(sizeRows[0]?.bytes ?? 0)
  const overBudget = sizeBytes > sizeAlarmBytes

  const summary = {
    bufferedBatches: buffered.flushed,
    deadLetteredBatches: buffered.dropped,
    rolledUpDays: days.length,
    metricPoints,
    events,
    rollupRows,
    sessions,
    devices,
    rawRetentionDays: rawRetention,
    rollupRetentionDays: rollupRetention,
    sizeBytes,
    overBudget
  }

  if (overBudget) {
    console.error('[prune] database is over its size alarm; shorten RAW_RETENTION_DAYS or trim the ingest allowlist', summary)
    throw createError({ statusCode: 507, statusMessage: 'Database over size alarm', data: summary })
  }

  return summary
})

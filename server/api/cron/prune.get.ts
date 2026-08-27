import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { NOISY_EVENT_NAMES } from '../../utils/otlp'
import { bearerToken } from '../../utils/deviceToken'

const NOISY_EVENT_WINDOW_DAYS = 30
const DEFAULT_RETENTION_DAYS = 90

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

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!isCronRequest(event, String(config.cronSecret ?? ''))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const configured = Number(config.retentionDays)
  const retentionDays = Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : DEFAULT_RETENTION_DAYS

  const sql = db()
  const deleteCount = async (text: string, params: unknown[]): Promise<number> => {
    const rows = await sql.query(`with d as (${text} returning 1) select count(*)::int as deleted from d`, params)
    return Number(rows[0]?.deleted ?? 0)
  }

  const noisyEvents = await deleteCount(
    'delete from telemetry.event where name = any($1::text[]) and ts < now() - make_interval(days => $2::int)',
    [[...NOISY_EVENT_NAMES], NOISY_EVENT_WINDOW_DAYS]
  )
  const metricPoints = await deleteCount(
    'delete from telemetry.metric_point where ts < now() - make_interval(days => $1::int)',
    [retentionDays]
  )
  const agedEvents = await deleteCount(
    'delete from telemetry.event where ts < now() - make_interval(days => $1::int)',
    [retentionDays]
  )
  const sessions = await deleteCount(
    'delete from telemetry.session s'
    + ' where not exists (select 1 from telemetry.metric_point m where m.session_id = s.session_id)'
    + ' and not exists (select 1 from telemetry.event e where e.session_id = s.session_id)',
    []
  )

  // Only a device that has stopped mattering is retired: revoked, or provisioned and never used.
  // A machine that is still reporting keeps its row however old its telemetry gets, and the window
  // is measured from revocation rather than creation so a just-revoked device does not vanish.
  const devices = await deleteCount(
    'delete from telemetry.device d'
    + ' where (d.revoked_at is not null or d.first_seen is null)'
    + ' and coalesce(d.revoked_at, d.created_at) < now() - make_interval(days => $1::int)'
    + ' and not exists (select 1 from telemetry.session s where s.device_id = d.id)'
    + ' and not exists (select 1 from telemetry.metric_point m where m.device_id = d.id)'
    + ' and not exists (select 1 from telemetry.event e where e.device_id = d.id)',
    [retentionDays]
  )

  return { metricPoints, events: noisyEvents + agedEvents, sessions, devices }
})

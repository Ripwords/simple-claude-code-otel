import { NOISY_EVENT_NAMES } from '../../utils/otlp'
import { requireBearer } from '../../utils/ingestAuth'

const NOISY_EVENT_WINDOW_DAYS = 30
const DEFAULT_RETENTION_DAYS = 90

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!getRequestHeader(event, 'x-vercel-cron')) requireBearer(event, config.ingestToken)

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

  return { metricPoints, events: noisyEvents + agedEvents, sessions }
})

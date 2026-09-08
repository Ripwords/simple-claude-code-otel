/**
 * Proves the daily rollups answer what the raw rows answer, for a day held by both.
 *
 * Counts and sums must match exactly; sums only can because metric_daily.value is numeric, so
 * there is no float reassociation between the two paths. Percentiles are held to the bucket
 * width, which is the whole guarantee the histogram offers.
 *
 * Run with: bun --env-file=.env.local scripts/verify-rollup.ts
 */
import { neon } from '@neondatabase/serverless'
import { BUCKET_ERROR_BOUND, buildDayRollup } from '../server/utils/rollup'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run `vercel env pull .env.local` first.')
  process.exit(1)
}

const sql = neon(url)
let failures = 0

function ok(label: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!condition) failures += 1
}

/** The most recent complete UTC day that is still held raw, so both paths can answer it. */
const dayRows = await sql.query(
  `select (ts at time zone 'utc')::date::text as day
   from telemetry.event
   where ts < date_trunc('day', now() at time zone 'utc')
   group by 1 order by 1 desc limit 1`, [])

const day = dayRows[0]?.day as string | undefined
if (!day) {
  console.error('no complete day is held both raw and rolled up; nothing to compare')
  process.exit(1)
}
console.log(`comparing rollup against raw for ${day}\n`)

const bounds = { from: `${day}T00:00:00Z`, to: `${day}T23:59:59.999Z` }

const eventDiff = await sql.query(`
  with rolled as (
    select device_id, name, attr_key, events, failures
    from telemetry.event_daily where day = $1::date
  ),
  raw as (
    select device_id, name,
      coalesce(case name
        when 'claude_code.tool_result' then attrs->>'tool_name'
        when 'claude_code.api_error' then attrs->>'status_code'
      end, '') as attr_key,
      count(*) as events,
      count(*) filter (where name = 'claude_code.tool_result' and attrs->>'success' is distinct from 'true') as failures
    from telemetry.event
    where ts >= ($1::date)::timestamp at time zone 'utc'
      and ts < ($1::date + 1)::timestamp at time zone 'utc'
    group by 1, 2, 3
  )
  select count(*)::int as mismatches from (
    select device_id, name, attr_key, events, failures from rolled
    except all
    select device_id, name, attr_key, events, failures from raw
  ) d`, [day])

ok('event_daily counts and failures match raw exactly', Number(eventDiff[0]!.mismatches) === 0,
  `${eventDiff[0]!.mismatches} mismatched groups`)

const metricDiff = await sql.query(`
  with rolled as (
    select device_id, metric, model, attr_key, value
    from telemetry.metric_daily where day = $1::date
  ),
  raw as (
    select device_id, metric, coalesce(model, '') as model,
      coalesce(case metric
        when 'claude_code.token.usage' then attrs->>'type'
        when 'claude_code.lines_of_code.count' then attrs->>'type'
        when 'claude_code.code_edit_tool.decision' then attrs->>'decision'
      end, '') as attr_key,
      sum(value::numeric) as value
    from telemetry.metric_point
    where ts >= ($1::date)::timestamp at time zone 'utc'
      and ts < ($1::date + 1)::timestamp at time zone 'utc'
    group by 1, 2, 3, 4
  )
  select count(*)::int as mismatches from (
    select * from rolled except all select * from raw
  ) d`, [day])

ok('metric_daily sums match raw exactly', Number(metricDiff[0]!.mismatches) === 0,
  `${metricDiff[0]!.mismatches} mismatched groups`)

const percentiles = await sql.query(`
  with cum as (
    select name, bucket, n,
      sum(n) over (partition by name order by bucket) as running,
      sum(n) over (partition by name) as total
    from (select name, bucket, sum(n) as n from telemetry.event_duration_daily where day = $1::date group by 1, 2) b
  ),
  quantiles as (select unnest(array[0.5, 0.95]) as p),
  estimated as (
    select distinct on (c.name, q.p) c.name, q.p,
      power(2::double precision, (c.bucket + least(1, greatest(0, (q.p * c.total - (c.running - c.n)) / c.n))) / 8.0) as value
    from cum c cross join quantiles q
    where c.running >= q.p * c.total
    order by c.name, q.p, c.bucket
  ),
  exact as (
    select name, 0.5::numeric as p, percentile_cont(0.5) within group (order by duration_ms) as value
    from telemetry.event
    where ts >= ($1::date)::timestamp at time zone 'utc'
      and ts < ($1::date + 1)::timestamp at time zone 'utc' and duration_ms is not null
    group by 1
    union all
    select name, 0.95, percentile_cont(0.95) within group (order by duration_ms)
    from telemetry.event
    where ts >= ($1::date)::timestamp at time zone 'utc'
      and ts < ($1::date + 1)::timestamp at time zone 'utc' and duration_ms is not null
    group by 1
  )
  select e.name, e.p, e.value as estimated, x.value as exact,
    abs(e.value - x.value) / greatest(x.value, 1) as error
  from estimated e join exact x on x.name = e.name and x.p = e.p
  order by e.name, e.p`, [day])

for (const row of percentiles) {
  const error = Number(row.error)
  ok(`p${Number(row.p) * 100} of ${row.name} within the bucket bound`,
    error <= BUCKET_ERROR_BOUND,
    `estimated ${Math.round(Number(row.estimated))}ms vs exact ${Math.round(Number(row.exact))}ms, ${(error * 100).toFixed(2)}% <= ${(BUCKET_ERROR_BOUND * 100).toFixed(2)}%`)
}
ok('percentiles were actually compared', percentiles.length > 0, `${percentiles.length} comparisons`)

// A re-roll has to converge, because the cron re-rolls the whole raw window on every run.
async function fingerprint(): Promise<string> {
  const rows = await sql.query(`
    select md5(string_agg(t, '|' order by t)) as h from (
      select device_id::text || name || attr_key || events::text || failures::text as t
      from telemetry.event_daily where day = $1::date
      union all
      select device_id::text || metric || model || attr_key || value::text
      from telemetry.metric_daily where day = $1::date
      union all
      select device_id::text || name || bucket::text || n::text
      from telemetry.event_duration_daily where day = $1::date
    ) s`, [day])
  return String(rows[0]!.h)
}

async function roll(): Promise<void> {
  for (const statement of buildDayRollup(day!)) await sql.query(statement.text, statement.params)
}

const storedFingerprint = await fingerprint()
await roll()
const first = await fingerprint()
await roll()
ok('re-rolling the same day converges', first === await fingerprint())
ok('the stored rollup already matched a fresh roll', storedFingerprint === first,
  storedFingerprint === first ? '' : 'stale rows were rewritten; re-roll every retained day')

const counts = await sql.query(`
  select
    (select count(*) from telemetry.event_daily where day = $1::date) as event_groups,
    (select count(*) from telemetry.metric_daily where day = $1::date) as metric_groups`, [day])
ok('the day is not empty', Number(counts[0]!.event_groups) > 0 && Number(counts[0]!.metric_groups) > 0,
  `${counts[0]!.event_groups} event groups, ${counts[0]!.metric_groups} metric groups`)

console.log(`\nrange under test: ${bounds.from} .. ${bounds.to}`)
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

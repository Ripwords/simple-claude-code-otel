import { EVENTS, METRICS } from '#shared/types'
import { EVENT_ATTR_ALLOWLIST, METRIC_ATTR_ALLOWLIST, type Statement } from './otlp'

/**
 * Latency is summarised as a log-scale histogram so p50 and p95 outlive the raw rows.
 * Eight buckets per octave puts a hard ceiling on how wrong a reported quantile can be:
 * any value in bucket b lies in [2^(b/8), 2^((b+1)/8)), a span of 2^(1/8) - 1.
 * Power-of-two buckets would allow 100% error and would interpolate across an octave,
 * which is exactly the assumption a log-scaled variable breaks.
 */
export const BUCKETS_PER_OCTAVE = 8
export const MAX_BUCKET = 160
export const BUCKET_ERROR_BOUND = 2 ** (1 / BUCKETS_PER_OCTAVE) - 1

/**
 * The bucket expression, in SQL. The rollup writer, the raw half of every read, and
 * verify-rollup all call this rather than spelling it out, because a histogram written
 * under one expression and read under another silently reports the wrong percentile.
 */
export const DURATION_BUCKET_SQL = (column: string): string =>
  `least(${MAX_BUCKET}, greatest(0, floor(${BUCKETS_PER_OCTAVE} * ln(greatest(${column}, 1)::double precision) / ln(2))::int))::smallint`

/** The same function in JS, for the read path and for tests. */
export function durationBucket(ms: number): number {
  const clamped = Math.max(ms, 1)
  return Math.min(MAX_BUCKET, Math.max(0, Math.floor(BUCKETS_PER_OCTAVE * Math.log(clamped) / Math.LN2)))
}

export type Histogram = Map<number, number>

export function mergeHistograms(histograms: readonly Histogram[]): Histogram {
  const merged: Histogram = new Map()
  for (const histogram of histograms) {
    for (const [bucket, n] of histogram) merged.set(bucket, (merged.get(bucket) ?? 0) + n)
  }
  return merged
}

/** Null when nothing was observed, so an empty range reads as "no data" rather than 0 ms. */
export function quantileFromHistogram(histogram: Histogram, q: number): number | null {
  const buckets = [...histogram.entries()].sort((a, b) => a[0] - b[0])
  const total = buckets.reduce((sum, [, n]) => sum + n, 0)
  if (total === 0) return null

  const rank = q * total
  let below = 0
  for (const [bucket, n] of buckets) {
    if (below + n >= rank) {
      const fraction = n === 0 ? 0 : Math.min(1, Math.max(0, (rank - below) / n))
      return 2 ** ((bucket + fraction) / BUCKETS_PER_OCTAVE)
    }
    below += n
  }

  const [last] = buckets[buckets.length - 1]!
  return 2 ** ((last + 1) / BUCKETS_PER_OCTAVE)
}

// A date is truncated in the session's TimeZone, which the HTTP driver never sets and which
// nothing in this project asserts. Casting to a bare timestamp first removes the ambiguity:
// the day boundary is UTC because it says so, not because the server happens to be.
const DAY_START = `($1::date)::timestamp at time zone 'utc'`
const DAY_END = `($1::date + 1)::timestamp at time zone 'utc'`

// The rollup summarises exactly what ingest stores. Filtering here as well as at the door
// looks redundant, but it is what keeps a rollup built over older rows -- a backfill across a
// change to the allowlist -- from carrying names that no records will ever join again, which
// would put a step in every chart at the date the allowlist changed.
const inList = (names: readonly string[]): string => names.map(name => `'${name}'`).join(', ')
const EVENT_NAMES = inList(Object.keys(EVENT_ATTR_ALLOWLIST))
const METRIC_NAMES = inList(Object.keys(METRIC_ATTR_ALLOWLIST))

/**
 * Replaces one UTC day in every rollup table. Delete-then-insert rather than an upsert:
 * `on conflict do update` converges only for keys still present in the source, so a key that
 * stops occurring keeps its stale row forever. Replacing the day converges under any change,
 * which is what lets the cron re-roll a window and absorb late-arriving telemetry.
 */
export function buildDayRollup(day: string): Statement[] {
  return [
    { text: 'delete from telemetry.metric_daily where day = $1::date', params: [day] },
    {
      text: `insert into telemetry.metric_daily (day, device_id, metric, model, attr_key, value, points)
        select $1::date, m.device_id, m.metric, coalesce(m.model, ''),
          coalesce(case m.metric
            when '${METRICS.tokens}' then m.attrs->>'type'
            when '${METRICS.linesOfCode}' then m.attrs->>'type'
            when '${METRICS.editDecision}' then m.attrs->>'decision'
          end, ''),
          sum(m.value::numeric), count(*)
        from telemetry.metric_point m
        where m.ts >= ${DAY_START} and m.ts < ${DAY_END} and m.metric in (${METRIC_NAMES})
        group by 2, 3, 4, 5`,
      params: [day]
    },
    { text: 'delete from telemetry.event_daily where day = $1::date', params: [day] },
    {
      text: `insert into telemetry.event_daily (day, device_id, name, attr_key, events, failures)
        select $1::date, e.device_id, e.name,
          coalesce(case e.name
            when '${EVENTS.toolResult}' then e.attrs->>'tool_name'
            when '${EVENTS.apiError}' then e.attrs->>'status_code'
          end, ''),
          count(*),
          count(*) filter (where e.name = '${EVENTS.toolResult}' and e.attrs->>'success' is distinct from 'true')
        from telemetry.event e
        where e.ts >= ${DAY_START} and e.ts < ${DAY_END} and e.name in (${EVENT_NAMES})
        group by 2, 3, 4`,
      params: [day]
    },
    { text: 'delete from telemetry.event_duration_daily where day = $1::date', params: [day] },
    {
      // Null durations are excluded so the histogram counts exactly what percentile_cont
      // would have seen on the raw rows.
      text: `insert into telemetry.event_duration_daily (day, device_id, name, bucket, n)
        select $1::date, e.device_id, e.name, ${DURATION_BUCKET_SQL('e.duration_ms')}, count(*)
        from telemetry.event e
        where e.ts >= ${DAY_START} and e.ts < ${DAY_END} and e.duration_ms is not null
          and e.name in (${EVENT_NAMES})
        group by 2, 3, 4`,
      params: [day]
    }
  ]
}

export function buildRawPrune(rawRetentionDays: number): Statement[] {
  return ['telemetry.metric_point', 'telemetry.event'].map(table => ({
    text: `delete from ${table} where ts < now() - make_interval(days => $1::int)`,
    params: [rawRetentionDays]
  }))
}

export function buildRollupPrune(rollupRetentionDays: number): Statement[] {
  const rollups = ['telemetry.metric_daily', 'telemetry.event_daily', 'telemetry.event_duration_daily'].map(table => ({
    text: `delete from ${table} where day < (now() - make_interval(days => $1::int))::date`,
    params: [rollupRetentionDays]
  }))

  return [
    ...rollups,
    // Sessions are counted straight off this table, so they must age on their own clock. The
    // rule this replaces retired a session once no fact row referenced it, which under a short
    // raw window would erase every session older than that window along with the counts that
    // read them.
    {
      text: 'delete from telemetry.session where last_seen_at < now() - make_interval(days => $1::int)',
      params: [rollupRetentionDays]
    }
  ]
}

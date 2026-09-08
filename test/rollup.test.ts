import { describe, expect, it } from 'vitest'
import {
  BUCKETS_PER_OCTAVE,
  BUCKET_ERROR_BOUND,
  DURATION_BUCKET_SQL,
  MAX_BUCKET,
  buildDayRollup,
  buildRawPrune,
  buildRollupPrune,
  durationBucket,
  mergeHistograms,
  quantileFromHistogram
} from '../server/utils/rollup'

const DAY = '2026-09-03'

function exactQuantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const rank = q * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low)
}

function histogramOf(values: number[]): Map<number, number> {
  const hist = new Map<number, number>()
  for (const value of values) {
    const bucket = durationBucket(value)
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
  }
  return hist
}

// A latency-shaped sample: a dense fast mode plus a decade-wide tail, which is the case
// averaging per-day percentiles gets wrong and a histogram does not.
function latencySample(count: number): number[] {
  let seed = 12345
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  return Array.from({ length: count }, () => (random() < 0.9 ? 20 + random() * 400 : 2000 + random() * 40000))
}

describe('durationBucket', () => {
  it('places an octave in exactly BUCKETS_PER_OCTAVE buckets', () => {
    expect(durationBucket(256) - durationBucket(128)).toBe(BUCKETS_PER_OCTAVE)
    expect(durationBucket(1024) - durationBucket(512)).toBe(BUCKETS_PER_OCTAVE)
  })

  it('floors everything at or below one millisecond into bucket zero', () => {
    expect(durationBucket(0)).toBe(0)
    expect(durationBucket(1)).toBe(0)
    expect(durationBucket(-5)).toBe(0)
  })

  it('clamps the tail rather than growing the bucket space without bound', () => {
    expect(durationBucket(2 ** 30)).toBe(MAX_BUCKET)
    expect(durationBucket(Number.MAX_SAFE_INTEGER)).toBe(MAX_BUCKET)
  })

  it('is monotonic across the whole range', () => {
    let previous = -1
    for (let ms = 1; ms < 1_000_000; ms = Math.ceil(ms * 1.05)) {
      const bucket = durationBucket(ms)
      expect(bucket).toBeGreaterThanOrEqual(previous)
      previous = bucket
    }
  })
})

describe('mergeHistograms', () => {
  it('sums bucket counts, which is what makes a multi-day range exact', () => {
    const merged = mergeHistograms([
      new Map([[10, 3], [20, 1]]),
      new Map([[10, 4], [30, 2]])
    ])

    expect([...merged.entries()].sort((a, b) => a[0] - b[0])).toEqual([[10, 7], [20, 1], [30, 2]])
  })

  it('is associative, so the order days are folded in cannot change the answer', () => {
    const [a, b, c] = [histogramOf(latencySample(50)), histogramOf(latencySample(60)), histogramOf(latencySample(70))]
    const left = mergeHistograms([mergeHistograms([a!, b!]), c!])
    const right = mergeHistograms([a!, mergeHistograms([b!, c!])])

    expect([...left.entries()].sort()).toEqual([...right.entries()].sort())
  })

  it('returns an empty histogram for no input', () => {
    expect(mergeHistograms([]).size).toBe(0)
  })
})

describe('quantileFromHistogram', () => {
  it('has no answer for an empty histogram rather than inventing a zero', () => {
    expect(quantileFromHistogram(new Map(), 0.5)).toBeNull()
  })

  it('lands inside the bucket that holds a single observation', () => {
    const value = quantileFromHistogram(histogramOf([300]), 0.5)!
    expect(value).toBeGreaterThanOrEqual(300 / (1 + BUCKET_ERROR_BOUND))
    expect(value).toBeLessThanOrEqual(300 * (1 + BUCKET_ERROR_BOUND))
  })

  it.each([0.5, 0.95, 0.99])('stays inside the %s error bound on a latency-shaped sample', (q) => {
    const values = latencySample(20_000)
    const estimate = quantileFromHistogram(histogramOf(values), q)!
    const exact = exactQuantile(values, q)

    expect(Math.abs(estimate - exact) / exact).toBeLessThanOrEqual(BUCKET_ERROR_BOUND)
  })

  it('matches the union of days when the days are merged first', () => {
    const days = [latencySample(3000), latencySample(4000), latencySample(5000)]
    const merged = mergeHistograms(days.map(histogramOf))
    const estimate = quantileFromHistogram(merged, 0.95)!
    const exact = exactQuantile(days.flat(), 0.95)

    expect(Math.abs(estimate - exact) / exact).toBeLessThanOrEqual(BUCKET_ERROR_BOUND)
  })
})

describe('buildDayRollup', () => {
  const statements = buildDayRollup(DAY)

  it('pairs a delete with an insert for each of the three rollup tables', () => {
    expect(statements).toHaveLength(6)
    expect(statements.filter(s => s.text.startsWith('delete from'))).toHaveLength(3)
    expect(statements.map(s => s.params)).toEqual(Array.from({ length: 6 }, () => [DAY]))
  })

  // on conflict do update converges only for keys still present in the source; a key that
  // stops occurring would leave its stale row behind forever. Replacing the day is what makes
  // a re-roll idempotent under any change to the underlying rows.
  it('replaces the day rather than upserting into it', () => {
    for (const statement of statements) expect(statement.text).not.toContain('on conflict')
    expect(statements[0]!.text).toContain('delete from telemetry.metric_daily where day = $1::date')
    expect(statements[2]!.text).toContain('delete from telemetry.event_daily where day = $1::date')
    expect(statements[4]!.text).toContain('delete from telemetry.event_duration_daily where day = $1::date')
  })

  // A backfill runs over rows older than the current allowlist. Without this filter it would
  // summarise names ingest no longer stores, putting a step in every chart on the day the
  // allowlist changed.
  it('summarises only the names ingest stores', () => {
    const inserts = statements.filter(s => s.text.startsWith('insert'))

    for (const statement of inserts.filter(s => s.text.includes('telemetry.event_'))) {
      expect(statement.text).toContain(`e.name in ('claude_code.api_request', 'claude_code.api_error', 'claude_code.tool_result')`)
    }
    expect(inserts[0]!.text).toContain('m.metric in (')
    expect(inserts[0]!.text).toContain(`'claude_code.cost.usage'`)
  })

  it('bounds every day with an explicit UTC boundary, never a session-local one', () => {
    for (const statement of statements.filter(s => s.text.startsWith('insert'))) {
      expect(statement.text).toContain(`($1::date)::timestamp at time zone 'utc'`)
      expect(statement.text).toContain(`($1::date + 1)::timestamp at time zone 'utc'`)
      expect(statement.text).not.toMatch(/date_trunc\('day', [a-z]+\.ts\)/)
    }
  })

  it('buckets duration with the one shared expression', () => {
    expect(statements[5]!.text).toContain(DURATION_BUCKET_SQL('e.duration_ms'))
  })

  it('counts failures within each key group, not just per event name', () => {
    expect(statements[3]!.text).toContain(`count(*) filter (where e.name = 'claude_code.tool_result' and e.attrs->>'success' is distinct from 'true')`)
    expect(statements[3]!.text).toContain('group by 2, 3, 4')
  })
})

describe('prune statements', () => {
  it('cuts raw telemetry at the raw window', () => {
    const statements = buildRawPrune(7)
    expect(statements.map(s => s.params)).toEqual([[7], [7]])
    expect(statements[0]!.text).toContain('delete from telemetry.metric_point')
    expect(statements[1]!.text).toContain('delete from telemetry.event')
  })

  // The old rule deleted a session once no fact row referenced it. Under a seven-day raw
  // window that erases every session older than a week, and with it both the summary count
  // and the devices page's per-machine total.
  it('retires sessions on their own last_seen_at, never on surviving fact rows', () => {
    const sessions = buildRollupPrune(400).find(s => s.text.includes('telemetry.session'))!

    expect(sessions.text).toContain('last_seen_at < now() - make_interval(days => $1::int)')
    expect(sessions.text).not.toContain('not exists')
  })

  it('cuts every rollup table at the rollup window', () => {
    const tables = buildRollupPrune(400).map(s => s.text.match(/delete from (telemetry\.\w+)/)![1])

    expect(tables).toEqual([
      'telemetry.metric_daily',
      'telemetry.event_daily',
      'telemetry.event_duration_daily',
      'telemetry.session'
    ])
  })
})

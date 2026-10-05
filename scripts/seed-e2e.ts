/**
 * Fills the local e2e stack with a realistic fleet, for looking at the dashboard at the scale
 * production runs at: fourteen machines with uneven usage, thirty days of daily rollups plus
 * raw rows for today, and the states the notices exist for (one waiting on setup, one refused,
 * one just arrived, one revoked).
 *
 * Deterministic, so before/after screenshots compare like for like. Refuses to run against
 * anything but the local stack.
 *
 * Run with: bun --env-file=test/e2e/stack.env scripts/seed-e2e.ts
 */
import { neon } from '@neondatabase/serverless'
import { routeLocalNeon } from '#shared/neonLocal'
import { EVENTS, METRICS } from '#shared/types'

const url = process.env.DATABASE_URL ?? ''
if (!url.includes('db.localtest.me')) {
  console.error('Refusing to seed: DATABASE_URL is not the local e2e stack.')
  process.exit(1)
}
routeLocalNeon()
const sql = neon(url)

let state = 42
const random = () => {
  state = (state * 1_103_515_245 + 12_345) % 2 ** 31
  return state / 2 ** 31
}

const DAY = 86_400_000
const today = Math.floor(Date.now() / DAY) * DAY
const iso = (ms: number) => new Date(ms).toISOString()
const dayOf = (n: number) => iso(today - n * DAY).slice(0, 10)

const MODELS = [
  ['claude-opus-4-8-20260714', 15, 75],
  ['claude-sonnet-4-6-20260212', 3, 15],
  ['claude-haiku-4-5-20251001', 1, 5],
  ['claude-fable-5-1', 20, 90]
] as const
const TOOLS = ['Edit', 'Bash', 'Read', 'Grep', 'Write', 'Task', 'WebFetch', 'Glob']

// [name, weight, model mix (opus, sonnet, haiku, fable), days active of 30]
const FLEET: Array<[string, number, [number, number, number, number], number]> = [
  ['jj-studio-mac', 1.0, [0.55, 0.25, 0.05, 0.15], 28],
  ['jj-macbook-air', 0.6, [0.2, 0.6, 0.2, 0], 22],
  ['ci-runner-sg', 0.9, [0, 0.3, 0.7, 0], 30],
  ['mei-thinkpad', 0.45, [0.4, 0.5, 0.1, 0], 18],
  ['ops-bastion', 0.12, [0, 0.2, 0.8, 0], 25],
  ['arif-linux-box', 0.7, [0.7, 0.2, 0, 0.1], 20],
  ['design-imac', 0.2, [0.1, 0.8, 0.1, 0], 12],
  ['priya-mbp-16', 0.85, [0.6, 0.3, 0.1, 0], 24],
  ['wen-surface', 0.3, [0.2, 0.7, 0.1, 0], 15],
  ['lab-gpu-01', 0.5, [0.3, 0.3, 0.4, 0], 26],
  ['kai-framework', 0.25, [0.5, 0.5, 0, 0], 10],
  ['sam-mac-mini', 0.4, [0.3, 0.4, 0.3, 0], 19]
]

await sql.query('truncate telemetry.device, telemetry.allowed_email cascade')

const ids: string[] = []
for (const [name] of FLEET) {
  const rows = await sql.query(
    `insert into telemetry.device (name, token_hash, token_prefix, created_at, first_seen, last_seen_at, account_uuid, account_email)
     values ($1, md5($1), substr(md5($1), 1, 8), now() - interval '40 days', now() - interval '35 days', now() - interval '5 minutes', md5('acct' || $1), $1 || '@example.com')
     returning id`, [name])
  ids.push(String(rows[0]!.id))
}

// The states the notices exist for.
await sql.query(`insert into telemetry.device (name, token_hash, token_prefix, created_at) values ('new-hire-laptop', md5('pending'), 'pending0', now() - interval '2 hours')`)
await sql.query(`update telemetry.device set first_seen = now() - interval '3 hours' where id = $1`, [ids[10]])
await sql.query(`update telemetry.device set rejected_account_uuid = md5('other'), rejected_account_email = 'someone-else@example.com', rejected_at = now() - interval '20 minutes', rejected_count = 37 where id = $1`, [ids[4]])
await sql.query(`update telemetry.device set revoked_at = now() - interval '9 days' where id = $1`, [ids[6]])

const metricDaily: unknown[][] = []
const eventDaily: unknown[][] = []
const durations: unknown[][] = []
const sessions: unknown[][] = []
const raw: unknown[][] = []

FLEET.forEach(([, weight, mix, activeDays], index) => {
  const deviceId = ids[index]!
  for (let n = 29; n >= 0; n--) {
    const weekday = new Date(today - n * DAY).getUTCDay() % 6 !== 0
    if (random() > activeDays / 30) continue
    const intensity = weight * (weekday ? 1 : 0.3) * (0.5 + random())
    const activeSeconds = Math.round(intensity * 6 * 3600)
    const toolCalls = Math.round(intensity * 420)
    const apiRequests = Math.round(intensity * 380)
    const added = Math.round(intensity * 900)

    const facts: Array<[string, string, string, number]> = [
      [METRICS.activeTime, '', '', activeSeconds],
      [METRICS.session, '', '', Math.max(1, Math.round(intensity * 6))],
      [METRICS.linesOfCode, '', 'added', added],
      [METRICS.linesOfCode, '', 'removed', Math.round(added * 0.35)]
    ]
    MODELS.forEach(([model, inputPerMillion, outputPerMillion], m) => {
      const share = mix[m]!
      if (share === 0) return
      const input = Math.round(intensity * share * 160_000)
      const output = Math.round(intensity * share * 55_000)
      const cacheRead = Math.round(intensity * share * 4_000_000)
      const cost = (input * inputPerMillion + output * outputPerMillion + cacheRead * inputPerMillion * 0.1) / 1e6
      facts.push([METRICS.cost, model, '', Number(cost.toFixed(4))])
      facts.push([METRICS.tokens, model, 'input', input])
      facts.push([METRICS.tokens, model, 'output', output])
      facts.push([METRICS.tokens, model, 'cacheRead', cacheRead])
      facts.push([METRICS.tokens, model, 'cacheCreation', Math.round(cacheRead * 0.06)])
    })

    if (n === 0) {
      // Today is answered from raw rows, so it is written there instead of the rollup.
      for (const [metric, model, type, value] of facts) {
        raw.push([iso(Math.min(Date.now() - 60_000, today + 3600_000 + random() * 6 * 3600_000)), deviceId, metric, model || null, value, JSON.stringify(type ? { type } : {})])
      }
    } else {
      for (const [metric, model, attrKey, value] of facts) metricDaily.push([dayOf(n), deviceId, metric, model, attrKey, value])
      let left = toolCalls
      TOOLS.forEach((tool, t) => {
        const count = t === TOOLS.length - 1 ? left : Math.round(left * (0.3 + random() * 0.2))
        left -= count
        if (count > 0) eventDaily.push([dayOf(n), deviceId, EVENTS.toolResult, tool, count, Math.round(count * random() * 0.04)])
      })
      eventDaily.push([dayOf(n), deviceId, EVENTS.apiRequest, '', apiRequests, 0])
      const errors = Math.round(apiRequests * random() * 0.03)
      if (errors > 0) {
        eventDaily.push([dayOf(n), deviceId, EVENTS.apiError, random() > 0.4 ? '529' : '429', errors, 0])
      }
      for (const [name, centre, count] of [[EVENTS.toolResult, 52, toolCalls], [EVENTS.apiRequest, 88, apiRequests]] as const) {
        for (let spread = -6; spread <= 6; spread++) {
          const n2 = Math.round(count * Math.exp(-(spread * spread) / 10) / 5.6)
          if (n2 > 0) durations.push([dayOf(n), deviceId, name, centre + spread, n2])
        }
      }
    }
    for (let s = 0; s < Math.max(1, Math.round(intensity * 6)); s++) {
      const start = today - n * DAY + 3600_000 * (8 + random() * 10)
      sessions.push([`${deviceId.slice(0, 8)}-${n}-${s}`, deviceId, iso(Math.min(start, Date.now() - 120_000)), iso(Math.min(start + 1800_000, Date.now() - 60_000))])
    }
  }
})

async function insert(table: string, columns: string, rows: unknown[][], casts: string[]) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400)
    const params: unknown[] = []
    const tuples = chunk.map(row => `(${row.map((value, c) => {
      params.push(value)
      return `$${params.length}${casts[c] ?? ''}`
    }).join(', ')})`)
    await sql.query(`insert into ${table} (${columns}) values ${tuples.join(', ')}`, params)
  }
}

await insert('telemetry.metric_daily', 'day, device_id, metric, model, attr_key, value, points', metricDaily.map(r => [...r, 1]), ['::date', '::uuid'])
await insert('telemetry.event_daily', 'day, device_id, name, attr_key, events, failures', eventDaily, ['::date', '::uuid'])
await insert('telemetry.event_duration_daily', 'day, device_id, name, bucket, n', durations, ['::date', '::uuid'])
await insert('telemetry.session', 'session_id, device_id, started_at, last_seen_at', sessions, ['', '::uuid', '::timestamptz', '::timestamptz'])
await insert('telemetry.metric_point', 'dedupe_key, ts, device_id, metric, model, value, attrs', raw.map(r => [crypto.randomUUID(), ...r]), ['::uuid', '::timestamptz', '::uuid', '', '', '', '::jsonb'])

console.log(`Seeded ${FLEET.length + 1} machines: ${metricDaily.length} rollup metric rows, ${eventDaily.length} rollup event rows, ${raw.length} raw rows today, ${sessions.length} sessions.`)

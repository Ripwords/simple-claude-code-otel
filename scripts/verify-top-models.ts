/**
 * End-to-end check of the "top models" tables against the local stack in test/e2e. Seeds three
 * machines whose correct answers are worked out by hand below, then reads them back through the
 * real HTTP API and the same ranking function the dashboard renders with.
 *
 * - solo: one model, raw rows only. Must show #1 at 100% and dashes for #2 and #3.
 * - busy: five models split across the rollup (earlier days) and raw (today) halves, plus a
 *   row with no model. Sonnet sits in both halves and must be merged before ranking. Cache
 *   tokens are seeded large enough to flip the token ranking if they leaked in.
 * - idle: only data older than the range. Must not appear at all.
 *
 * Refuses to run against anything but the local stack. Writes test/e2e/artifacts/top-models.json.
 *
 * Run with: bun --env-file=test/e2e/stack.env scripts/verify-top-models.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { routeLocalNeon } from '#shared/neonLocal'
import type { BreakdownRow } from '#shared/types'
import { rankTopModels } from '../app/utils/topModels'

const url = process.env.DATABASE_URL ?? ''
if (!url.includes('db.localtest.me')) {
  console.error('Refusing to seed: DATABASE_URL is not the local e2e stack.')
  process.exit(1)
}
const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const PASSWORD = process.env.DASHBOARD_PASSWORD ?? 'e2e-password-local'

routeLocalNeon()
const sql = neon(url)

const DAY = 86_400_000
const now = Date.now()
const today = new Date(Math.floor(now / DAY) * DAY)
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY).toISOString().slice(0, 10)
const rawTs = new Date(Math.max(today.getTime() + 60_000, now - 60_000)).toISOString()

const OPUS = 'claude-opus-4-8-20260714'
const SONNET = 'claude-sonnet-4-6-20260212'
const HAIKU = 'claude-haiku-4-5-20251001'
const OLD = 'claude-3-7-sonnet-20250219'
const FAST = 'claude-fable-5-1'

await sql.query('truncate telemetry.device cascade')
const [solo, busy, idle] = await Promise.all(['e2e-solo', 'e2e-busy', 'e2e-idle'].map(async (name) => {
  const rows = await sql.query(
    `insert into telemetry.device (name, token_hash, token_prefix, first_seen, last_seen_at)
     values ($1, md5($1), 'e2e', now(), now()) returning id`, [name])
  return String(rows[0]!.id)
}))

type Raw = [device: string, metric: string, model: string | null, type: string | null, value: number]
const raw = async (rows: Raw[]) => {
  for (const [device, metric, model, type, value] of rows) {
    await sql.query(
      `insert into telemetry.metric_point (dedupe_key, ts, device_id, metric, model, value, attrs)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
      [rawTs, device, metric, model, value, JSON.stringify(type ? { type } : {})])
  }
}
type Daily = [day: string, device: string, metric: string, model: string, attrKey: string, value: number]
const daily = async (rows: Daily[]) => {
  for (const [day, device, metric, model, attrKey, value] of rows) {
    await sql.query(
      `insert into telemetry.metric_daily (day, device_id, metric, model, attr_key, value, points)
       values ($1, $2, $3, $4, $5, $6, 1)`, [day, device, metric, model, attrKey, value])
  }
}

const COST = 'claude_code.cost.usage'
const TOKENS = 'claude_code.token.usage'

await raw([
  [solo, COST, OPUS, null, 4],
  [solo, TOKENS, OPUS, 'input', 1000],
  [solo, TOKENS, OPUS, 'output', 500],

  [busy, COST, SONNET, null, 3],
  [busy, COST, null, null, 1],
  [busy, TOKENS, SONNET, 'input', 20_000],
  [busy, TOKENS, HAIKU, 'output', 30_000],
  // Large enough to put opus first by tokens if cache tokens were counted.
  [busy, TOKENS, OPUS, 'cacheRead', 10_000_000]
])
await daily([
  [daysAgo(2), busy, COST, OPUS, '', 10],
  [daysAgo(2), busy, COST, SONNET, '', 4],
  [daysAgo(3), busy, COST, HAIKU, '', 2],
  [daysAgo(3), busy, COST, OLD, '', 0.5],
  [daysAgo(3), busy, COST, FAST, '', 0.5],
  [daysAgo(2), busy, TOKENS, OPUS, 'input', 5000],
  [daysAgo(2), busy, TOKENS, OPUS, 'output', 1000],
  [daysAgo(2), busy, TOKENS, SONNET, 'output', 25_000],
  [daysAgo(3), busy, TOKENS, OLD, 'input', 100],
  [daysAgo(30), idle, COST, OPUS, '', 99],
  [daysAgo(30), idle, TOKENS, OPUS, 'input', 99_999]
])

// Worked by hand from the rows above.
// busy cost: opus 10, sonnet 3+4=7, haiku 2, old 0.5, fable 0.5, unknown 1 -> total 21.
// busy tokens (input+output only): sonnet 45k, haiku 30k, opus 6k, old 100 -> total 81.1k.
const EXPECTED = {
  cost: {
    'e2e-busy': [[OPUS, 10, 10 / 21], [SONNET, 7, 7 / 21], [HAIKU, 2, 2 / 21]],
    'e2e-solo': [[OPUS, 4, 1]]
  },
  tokens: {
    'e2e-busy': [[SONNET, 45_000, 45_000 / 81_100], [HAIKU, 30_000, 30_000 / 81_100], [OPUS, 6000, 6000 / 81_100]],
    'e2e-solo': [[OPUS, 1500, 1]]
  }
} as const

let cookie = ''
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD })
})
cookie = login.headers.getSetCookie()[0]?.split(';')[0] ?? ''

const from = new Date(today.getTime() - 6 * DAY).toISOString()
const fetchRows = async (by: string): Promise<BreakdownRow[]> => {
  const res = await fetch(`${BASE}/api/stats/breakdown?by=${by}&from=${from}&to=${new Date().toISOString()}`, { headers: { cookie } })
  if (!res.ok) throw new Error(`${by}: HTTP ${res.status} ${await res.text()}`)
  return await res.json() as BreakdownRow[]
}

let failures = 0
const report: Record<string, unknown> = { ranAt: new Date().toISOString(), checks: [] as unknown[] }
const check = (label: string, pass: boolean, detail: unknown) => {
  if (!pass) failures += 1
  ;(report.checks as unknown[]).push({ label, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`)
}

for (const [table, by] of [['cost', 'model'], ['tokens', 'modelTokens']] as const) {
  const ranked = rankTopModels(await fetchRows(by))
  report[table] = ranked
  check(`${table}: idle machine is left out`, ranked.every(m => m.device !== 'e2e-idle'), ranked.map(m => m.device))
  check(`${table}: Other and unknown never ranked`, ranked.every(m => m.models.every(x => x.model !== 'Other' && x.model !== 'unknown')), null)
  for (const [device, expected] of Object.entries(EXPECTED[table])) {
    const actual = ranked.find(m => m.device === device)?.models ?? []
    const same = actual.length === expected.length && expected.every(([model, value, share], i) =>
      actual[i]?.model === model && Math.abs(actual[i]!.value - value) < 1e-9 && Math.abs(actual[i]!.share - share) < 1e-9)
    check(`${table}: ${device} ranks ${expected.map(e => e[0]).join(', ')}`, same, { expected, actual })
  }
}

mkdirSync('test/e2e/artifacts', { recursive: true })
writeFileSync('test/e2e/artifacts/top-models.json', JSON.stringify(report, null, 2))
console.log(failures === 0 ? '\nAll top-models checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)

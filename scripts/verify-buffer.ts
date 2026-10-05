/**
 * End-to-end check of the Redis ingest buffer against the local stack in test/e2e. Drives the
 * real HTTP server, then inspects Redis and Postgres directly to prove where the data is.
 *
 * 1. Parked: ingest writes nothing to Postgres while a flush is not due; a replayed batch is
 *    queued again but stored once.
 * 2. Cheap: a warm ingest request costs at most two top-level Redis commands.
 * 3. Fresh: a signed-in dashboard read drains the queue before answering.
 * 4. Durable: a flush that loses the database keeps the queue, and the next one resumes it
 *    with nothing lost or duplicated.
 * 5. Unblockable: a batch from a machine deleted while it waited is dropped, not retried
 *    forever, and the good batch beside it still lands.
 * 6. Revocation and rotation take effect at once despite the token cache.
 * 7. Ingest starts a flush by itself once the last one is old enough.
 *
 * Refuses to run against anything but the local stack. Writes test/e2e/artifacts/buffer-report.json.
 *
 * Run with: bun --env-file=test/e2e/stack.env scripts/verify-buffer.ts  (with `bun run e2e:dev` up)
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { Redis } from '@upstash/redis'
import { routeLocalNeon } from '#shared/neonLocal'

const url = process.env.DATABASE_URL ?? ''
if (!url.includes('db.localtest.me') || !process.env.UPSTASH_REDIS_REST_URL?.startsWith('http://localhost')) {
  console.error('Refusing to run: DATABASE_URL and UPSTASH_REDIS_REST_URL must point at the local e2e stack.')
  process.exit(1)
}
const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const PASSWORD = process.env.DASHBOARD_PASSWORD ?? 'e2e-password-local'
const PROXY = 'otel-e2e-neon-proxy-1'
const REDIS_CONTAINER = 'otel-e2e-redis-1'

routeLocalNeon()
const sql = neon(url)
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN!, automaticDeserialization: false })

const LOGS = JSON.parse(readFileSync('test/fixtures/logs.json', 'utf8'))
const METRICS = JSON.parse(readFileSync('test/fixtures/metrics.json', 'utf8'))

const report: { ranAt: string, checks: Array<{ label: string, pass: boolean, detail?: unknown }> } = { ranAt: new Date().toISOString(), checks: [] }
const check = (label: string, pass: boolean, detail?: unknown) => {
  report.checks.push({ label, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

let cookie = ''
async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const setCookie = res.headers.getSetCookie()[0]
  if (setCookie) cookie = setCookie.split(';')[0]!
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch { /* not json */ }
  return { status: res.status, json: json as Record<string, unknown> }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const queued = async () => Number(await redis.llen('ingest:queue')) + Number(await redis.llen('ingest:inflight'))
const factRows = async (deviceId?: string) => {
  const rows = await sql.query(
    `select (select count(*) from telemetry.metric_point where $1::uuid is null or device_id = $1)
          + (select count(*) from telemetry.event where $1::uuid is null or device_id = $1) as n`, [deviceId ?? null])
  return Number(rows[0]!.n)
}
const markFlushedRecently = () => redis.set('ingest:flushed-recently', '1', { ex: 1800 })

/** Posts both fixtures; returns how many rows the server says it will store. */
async function postFixtures(token: string): Promise<number> {
  let stored = 0
  for (const [path, body] of [['/api/otlp/v1/logs', LOGS], ['/api/otlp/v1/metrics', METRICS]] as const) {
    const res = await call('POST', path, body, token)
    if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(res.json)}`)
    stored += Number(res.json.stored ?? 0)
  }
  return stored
}

async function newDevice(name: string): Promise<{ id: string, token: string }> {
  const res = await call('POST', '/api/devices', { name })
  if (res.status !== 201) throw new Error(`create ${name}: HTTP ${res.status}`)
  return { id: String((res.json.device as Record<string, unknown>).id), token: String(res.json.token) }
}

// --- setup -----------------------------------------------------------------------------------
await redis.flushall()
await sql.query('truncate telemetry.device, telemetry.allowed_email cascade')
const login = await call('POST', '/api/auth/login', { password: PASSWORD })
if (login.status !== 200) throw new Error(`login: HTTP ${login.status}`)
await markFlushedRecently()

// --- 1. parked -------------------------------------------------------------------------------
const a = await newDevice('e2e-a')
const b = await newDevice('e2e-b')
const expectedA = await postFixtures(a.token)
const expectedB = await postFixtures(b.token)
await postFixtures(a.token) // replay: the exporter retried a batch it already delivered
check('1. nothing reaches Postgres while a flush is not due', await factRows() === 0, { rows: await factRows() })
check('1. every batch is parked, the replay included', await queued() === 6, { queued: await queued() })

// --- 2. cheap --------------------------------------------------------------------------------
const monitor = spawn('docker', ['exec', REDIS_CONTAINER, 'redis-cli', 'monitor'])
let monitored = ''
monitor.stdout.on('data', (chunk) => {
  monitored += String(chunk)
})
await sleep(500)
monitored = ''
await call('POST', '/api/otlp/v1/metrics', METRICS, b.token)
await sleep(500)
monitor.kill()
const topLevel = monitored.split('\n').filter(line => line.includes('"') && !line.includes(' lua]'))
check('2. a warm ingest request costs at most two Redis commands', topLevel.length > 0 && topLevel.length <= 2,
  { commands: topLevel.map(line => line.split('] ')[1]?.slice(0, 60)) })

// --- 3. fresh --------------------------------------------------------------------------------
const summary = await call('GET', '/api/stats/summary')
check('3. a signed-in dashboard read succeeds', summary.status === 200, { status: summary.status })
check('3. ...and drains the queue first', await queued() === 0, { queued: await queued() })
check('3. device A stored exactly once despite the replay', await factRows(a.id) === expectedA, { rows: await factRows(a.id), expectedA })
check('3. device B stored exactly once despite the repeat', await factRows(b.id) === expectedB, { rows: await factRows(b.id), expectedB })

// --- 4. durable ------------------------------------------------------------------------------
await markFlushedRecently()
const c = await newDevice('e2e-c')
const expectedC = await postFixtures(c.token)
execFileSync('docker', ['stop', PROXY])
try {
  const failed = await call('GET', '/api/stats/summary')
  check('4. with the database unreachable the read fails', failed.status >= 500, { status: failed.status })
  check('4. ...and the queue is kept', await queued() === 2, { queued: await queued() })
} finally {
  execFileSync('docker', ['start', PROXY])
}
await sleep(1500)
await call('GET', '/api/stats/summary')
check('4. the next flush resumes it', await queued() === 0, { queued: await queued() })
check('4. device C stored exactly once', await factRows(c.id) === expectedC, { rows: await factRows(c.id), expectedC })

// --- 5. unblockable --------------------------------------------------------------------------
await markFlushedRecently()
const doomed = await newDevice('e2e-doomed')
const survivor = await newDevice('e2e-survivor')
await postFixtures(doomed.token)
const expectedSurvivor = await postFixtures(survivor.token)
const deleted = await call('DELETE', `/api/devices/${doomed.id}`)
check('5. a machine with parked batches can be deleted', deleted.status === 200, { status: deleted.status })
await call('GET', '/api/stats/summary')
check('5. its batches are dropped, not left blocking the queue', await queued() === 0, { queued: await queued() })
check('5. the batches beside them still land', await factRows(survivor.id) === expectedSurvivor, { rows: await factRows(survivor.id), expectedSurvivor })

// --- 6. revocation and rotation --------------------------------------------------------------
await call('POST', '/api/otlp/v1/metrics', METRICS, a.token) // warm the cache
const revoked = await call('POST', `/api/devices/${a.id}/revoke`)
const afterRevoke = await call('POST', '/api/otlp/v1/metrics', METRICS, a.token)
check('6. a revoked token is refused at once', revoked.status === 200 && afterRevoke.status === 401, { revoke: revoked.status, ingest: afterRevoke.status })

await call('POST', '/api/otlp/v1/metrics', METRICS, b.token) // warm the cache
const rotated = await call('POST', `/api/devices/${b.id}/rotate`)
const oldToken = await call('POST', '/api/otlp/v1/metrics', METRICS, b.token)
const newToken = await call('POST', '/api/otlp/v1/metrics', METRICS, String(rotated.json.token))
check('6. a rotated-out token is refused at once', oldToken.status === 401, { status: oldToken.status })
check('6. the new token is accepted', newToken.status === 200, { status: newToken.status })

const unknown = await call('POST', '/api/otlp/v1/metrics', METRICS, 'not-a-real-token')
check('6. an unknown token is refused', unknown.status === 401, { status: unknown.status })

// --- 7. self-starting flush ------------------------------------------------------------------
await call('GET', '/api/stats/summary')
await redis.del('ingest:flushed-recently')
const f = await newDevice('e2e-f')
// One batch: a second one arriving while the first is being flushed rightly waits for the next flush.
const triggered = await call('POST', '/api/otlp/v1/metrics', METRICS, f.token)
const expectedF = Number(triggered.json.stored ?? 0)
let landed = 0
for (let i = 0; i < 20 && landed < expectedF; i++) {
  await sleep(250)
  landed = await factRows(f.id)
}
check('7. ingest flushes by itself once the last flush is old', landed === expectedF, { landed, expectedF })
check('7. ...and marks the flush so the next requests do not repeat it', Number(await redis.exists('ingest:flushed-recently')) === 1)

mkdirSync('test/e2e/artifacts', { recursive: true })
writeFileSync('test/e2e/artifacts/buffer-report.json', JSON.stringify(report, null, 2))
const failures = report.checks.filter(c => !c.pass).length
console.log(failures === 0 ? `\nAll ${report.checks.length} buffer checks passed.` : `\n${failures} of ${report.checks.length} checks failed.`)
process.exit(failures === 0 ? 0 : 1)

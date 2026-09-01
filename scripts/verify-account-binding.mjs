import { readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const PW = process.env.DASHBOARD_PASSWORD
if (!PW) {
  console.error('Set DASHBOARD_PASSWORD to the password whose hash is in DASHBOARD_PASSWORD_HASH.')
  process.exit(1)
}
let cookie = ''
let failures = 0

const call = async (method, path, body, token) => {
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const set = res.headers.getSetCookie?.()[0]
  if (set) cookie = set.split(';')[0]
  return { status: res.status, json: parseJson(await res.text()) }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const ok = (label, cond, detail = '') => {
  if (!cond) failures += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}

function rewriteAccount(body, uuid, email) {
  const clone = structuredClone(body)
  const walk = (attrs) => {
    for (const a of attrs ?? []) {
      if (a.key === 'user.account_uuid') a.value = { stringValue: uuid }
      if (a.key === 'user.email') a.value = { stringValue: email }
    }
  }
  for (const rm of clone.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) for (const dp of m.sum?.dataPoints ?? []) walk(dp.attributes)
    }
  }
  return clone
}

await call('POST', '/api/auth/login', { password: PW })
for (const d of (await call('GET', '/api/devices')).json ?? []) await call('DELETE', `/api/devices/${d.id}`)

const summary = async () => (await call('GET', `/api/stats/summary?from=${new Date(Date.now() - 30 * 864e5).toISOString()}&to=${new Date(Date.now() + 864e5).toISOString()}`)).json[0]

const metrics = JSON.parse(readFileSync('test/fixtures/metrics.json', 'utf8'))
const impostorEmail = 'someone.else@example.com'
const impostor = rewriteAccount(metrics, '00000000-dead-4000-8000-000000000000', impostorEmail)

const created = await call('POST', '/api/devices', { name: 'work-laptop' })
const id = created.json.device.id
const token = created.json.token
ok('new machine is unbound', created.json.device.account === null)

const first = await call('POST', '/api/otlp/v1/metrics', metrics, token)
ok('first telemetry accepted', first.status === 200, `accepted=${first.json?.accepted}`)
const bound = (await call('GET', '/api/devices')).json[0]
ok('machine claimed that account', bound.account !== null, `${bound.account?.email ?? bound.account?.uuid}`)

const rowsBefore = await summary()

const wrong = await call('POST', '/api/otlp/v1/metrics', impostor, token)
ok('a different account is refused with 403', wrong.status === 403, `got ${wrong.status}`)

const rowsAfter = await summary()
ok('the refused batch wrote nothing', rowsBefore.costUsd === rowsAfter.costUsd, `$${rowsBefore.costUsd} -> $${rowsAfter.costUsd}`)

const conflicted = (await call('GET', '/api/devices')).json[0]
ok('the attempt is recorded so the dashboard can explain it', conflicted.conflict !== null, `count=${conflicted.conflict?.count}`)

const allowed = await call('POST', '/api/allowlist', { email: impostorEmail })
ok('the refused email can be allowlisted by hand', allowed.json?.email === impostorEmail && allowed.json?.source === 'manual', `got ${allowed.status}`)

const guestBefore = await summary()
const guest = await call('POST', '/api/otlp/v1/metrics', impostor, token)
ok('an allowlisted account reports through a machine it does not own', guest.status === 200, `got ${guest.status}`)
const guestAfter = await summary()
ok('the guest batch was stored', guestAfter.costUsd > guestBefore.costUsd, `$${guestBefore.costUsd} -> $${guestAfter.costUsd}`)

const guested = (await call('GET', '/api/devices')).json[0]
ok('the guest did not take the machine over', guested.account?.uuid === bound.account?.uuid, guested.account?.email ?? '')
ok('the stale conflict is cleared once data lands again', guested.conflict === null)

const withOwner = (await call('GET', '/api/allowlist')).json
ok('every machine owner is on the list without being added', withOwner.some(e => e.email === bound.account?.email && e.source === 'device'), `${withOwner.length} listed`)

await call('DELETE', `/api/allowlist/${encodeURIComponent(impostorEmail)}`)
ok('removing the email refuses the same batch again', (await call('POST', '/api/otlp/v1/metrics', impostor, token)).status === 403)
ok('the hand-added entry is gone', ((await call('GET', '/api/allowlist')).json ?? []).every(e => e.email !== impostorEmail))

ok('the rightful account still works', (await call('POST', '/api/otlp/v1/metrics', metrics, token)).status === 200)

await call('POST', `/api/devices/${id}/release`)
const released = (await call('GET', '/api/devices')).json[0]
ok('release clears the binding and the conflict', released.account === null && released.conflict === null)

ok('the other account can now claim it', (await call('POST', '/api/otlp/v1/metrics', impostor, token)).status === 200)
const rebound = (await call('GET', '/api/devices')).json[0]
ok('and it is bound to the new account', rebound.account?.uuid === '00000000-dead-4000-8000-000000000000', rebound.account?.email ?? '')

await call('DELETE', `/api/devices/${id}`)
ok('cleaned up', ((await call('GET', '/api/devices')).json ?? []).length === 0)
ok('the last machine leaving empties the allowlist', ((await call('GET', '/api/allowlist')).json ?? []).length === 0)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

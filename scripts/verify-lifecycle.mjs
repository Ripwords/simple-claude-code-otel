import { readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const PW = process.env.DASHBOARD_PASSWORD
if (!PW) {
  console.error('Set DASHBOARD_PASSWORD to the password whose hash is in DASHBOARD_PASSWORD_HASH.')
  process.exit(1)
}
let cookie = ''

const call = async (method, path, body, token) => {
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const setCookie = res.headers.getSetCookie?.()[0]
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await res.text()
  return { status: res.status, json: parseJson(text) }
}

let failures = 0
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

const login = await call('POST', '/api/auth/login', { password: PW })
ok('sign in', login.status === 200)

for (const d of (await call('GET', '/api/devices')).json ?? []) await call('DELETE', `/api/devices/${d.id}`)

const created = await call('POST', '/api/devices', { name: 'Work MacBook' })
const id = created.json.device.id
const token = created.json.token
ok('create returns a token once', created.status === 201 && token.length === 48, `prefix=${created.json.device.tokenPrefix}`)
ok('created device is pending', created.json.device.status === 'pending')

const dup = await call('POST', '/api/devices', { name: 'Work MacBook' })
ok('duplicate name rejected with 409', dup.status === 409, `got ${dup.status}`)

const listed = await call('GET', '/api/devices')
ok('token never appears again', !JSON.stringify(listed.json).includes(token))

const metrics = JSON.parse(readFileSync('test/fixtures/metrics.json', 'utf8'))
const logs = JSON.parse(readFileSync('test/fixtures/logs.json', 'utf8'))
const mIn = await call('POST', '/api/otlp/v1/metrics', metrics, token)
const lIn = await call('POST', '/api/otlp/v1/logs', logs, token)
ok('ingest accepted with the minted token', mIn.status === 200 && lIn.status === 200, `metrics=${mIn.json?.accepted} logs=${lIn.json?.accepted}`)

const afterIngest = (await call('GET', '/api/devices')).json[0]
ok('status flips pending -> reporting', afterIngest.status === 'reporting', `firstSeen=${afterIngest.firstSeen}`)

const from = new Date(Date.now() - 30 * 864e5).toISOString()
const to = new Date(Date.now() + 864e5).toISOString()
const before = (await call('GET', `/api/stats/summary?from=${from}&to=${to}`)).json[0]

const renamed = await call('PATCH', `/api/devices/${id}`, { name: 'Personal Mac' })
ok('rename accepted', renamed.status === 200 && renamed.json.name === 'Personal Mac')

const after = (await call('GET', `/api/stats/summary?from=${from}&to=${to}`)).json[0]
ok('rename preserves device id', before.deviceId === after.deviceId)
ok('rename preserves every number', JSON.stringify({ ...before, device: null }) === JSON.stringify({ ...after, device: null }),
  `cost ${before.costUsd} -> ${after.costUsd}, label ${before.device} -> ${after.device}`)

const rotated = await call('POST', `/api/devices/${id}/rotate`)
const newToken = rotated.json.token
ok('rotate issues a different token', newToken !== token)
ok('old token now rejected', (await call('POST', '/api/otlp/v1/metrics', metrics, token)).status === 401)
ok('new token accepted', (await call('POST', '/api/otlp/v1/metrics', metrics, newToken)).status === 200)

const stillThere = (await call('GET', `/api/stats/summary?from=${from}&to=${to}`)).json[0]
ok('rotate preserves history', stillThere.deviceId === before.deviceId && stillThere.sessions === before.sessions)

await call('POST', `/api/devices/${id}/revoke`)
ok('revoked device rejected at ingest', (await call('POST', '/api/otlp/v1/metrics', metrics, newToken)).status === 401)
const revokedSummary = (await call('GET', `/api/stats/summary?from=${from}&to=${to}`)).json[0]
ok('revoked device keeps its spend on the dashboard', revokedSummary?.costUsd === stillThere.costUsd, `$${revokedSummary?.costUsd}`)

const revokeTwice = await call('POST', `/api/devices/${id}/revoke`)
ok('revoke is idempotent', revokeTwice.status === 200)

const deleted = await call('DELETE', `/api/devices/${id}`)
ok('delete reports the cascade', deleted.status === 200, JSON.stringify(deleted.json))
ok('device is gone', (await call('GET', '/api/devices')).json.length === 0)
ok('its telemetry is gone', ((await call('GET', `/api/stats/summary?from=${from}&to=${to}`)).json ?? []).length === 0)

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

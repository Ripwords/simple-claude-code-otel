import { describe, expect, it } from 'vitest'
import { compareDevices, deviceNameSchema, parseDeviceId, toDeviceInfo } from '../server/utils/deviceQueries'
import { accountConflictError, deviceStatus } from '../server/utils/deviceToken'
import { TOKEN_PLACEHOLDER, setupCommand } from '../app/utils/deviceStatus'
import type { DeviceInfo, DeviceStatus } from '../shared/types'

const UUID = '9d5f5a3e-1c2b-4f7a-9e8d-6b7c8d9e0f1a'
const NAME_64 = 'a'.repeat(64)
const CLAIMED_ACCOUNT = '11da1661-c0ff-46af-b748-a672c71d09c7'
const OTHER_ACCOUNT = '4c8b0d92-77ae-4a1f-9d63-0e2f5a1b8c40'

function device(name: string, status: DeviceStatus): DeviceInfo {
  return {
    id: UUID,
    name,
    tokenPrefix: 'abcd1234',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    firstSeen: null,
    lastSeen: null,
    revokedAt: null,
    sessions: 0,
    account: null,
    conflict: null
  }
}

describe('deviceNameSchema', () => {
  it('trims surrounding whitespace and keeps inner spaces', () => {
    expect(deviceNameSchema.parse('  Work MacBook  ')).toBe('Work MacBook')
  })

  it('rejects an empty name', () => {
    expect(deviceNameSchema.safeParse('').success).toBe(false)
  })

  it('rejects a whitespace-only name, so trimming happens before the length check', () => {
    expect(deviceNameSchema.safeParse('   ').success).toBe(false)
  })

  it('accepts a 64 character name', () => {
    expect(deviceNameSchema.parse(NAME_64)).toBe(NAME_64)
  })

  it('rejects a 65 character name', () => {
    expect(deviceNameSchema.safeParse('a'.repeat(65)).success).toBe(false)
  })

  it('accepts a 64 character name padded to 70, so trimming happens before the max check', () => {
    expect(deviceNameSchema.parse(`   ${NAME_64}   `)).toBe(NAME_64)
  })

  it('rejects a non-string', () => {
    expect(deviceNameSchema.safeParse(42).success).toBe(false)
  })
})

describe('parseDeviceId', () => {
  it('returns a valid uuid unchanged', () => {
    expect(parseDeviceId(UUID)).toBe(UUID)
  })

  it.each([['not-a-uuid'], [''], [undefined], ['12345']])('rejects %o with a 400', (raw) => {
    expect(() => parseDeviceId(raw)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('deviceStatus', () => {
  const seen = new Date('2026-01-02T00:00:00.000Z')

  it('is pending before a device has reported', () => {
    expect(deviceStatus(null, null)).toBe('pending')
  })

  it('is reporting once a device has been seen', () => {
    expect(deviceStatus(seen, null)).toBe('reporting')
  })

  it('is revoked when revoked before ever reporting', () => {
    expect(deviceStatus(null, seen)).toBe('revoked')
  })

  it('lets revocation win over first_seen', () => {
    expect(deviceStatus(seen, seen)).toBe('revoked')
  })
})

describe('compareDevices', () => {
  it('orders pending, then reporting, then revoked', () => {
    const sorted = [device('c', 'revoked'), device('b', 'reporting'), device('a', 'pending')].sort(compareDevices)
    expect(sorted.map(d => d.name)).toEqual(['a', 'b', 'c'])
  })

  it('orders by name within a status group', () => {
    const sorted = [device('zeta', 'reporting'), device('alpha', 'reporting'), device('mid', 'reporting')].sort(compareDevices)
    expect(sorted.map(d => d.name)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('ranks status above name', () => {
    const sorted = [device('alpha', 'revoked'), device('zeta', 'pending')].sort(compareDevices)
    expect(sorted.map(d => d.name)).toEqual(['zeta', 'alpha'])
  })
})

describe('toDeviceInfo', () => {
  const row = {
    id: UUID,
    name: 'Work MacBook',
    token_prefix: 'abcd1234',
    created_at: '2026-01-01T00:00:00Z',
    first_seen: null,
    last_seen_at: null,
    revoked_at: null,
    sessions: '0',
    account_uuid: null,
    account_email: null,
    rejected_account_uuid: null,
    rejected_account_email: null,
    rejected_at: null,
    rejected_count: '0'
  }

  it('leaves revokedAt null while a device is live', () => {
    expect(toDeviceInfo(row)).toMatchObject({ status: 'pending', revokedAt: null })
  })

  it('surfaces revokedAt so a preserved revocation timestamp is observable', () => {
    const revoked = toDeviceInfo({ ...row, revoked_at: '2026-01-02T03:04:05.678Z' })
    expect(revoked.status).toBe('revoked')
    expect(revoked.revokedAt).toBe('2026-01-02T03:04:05.678Z')
  })

  it('coerces the session count the neon driver returns as a string', () => {
    expect(toDeviceInfo({ ...row, sessions: '7' }).sessions).toBe(7)
  })

  it('never carries a token or its hash', () => {
    const info = toDeviceInfo({ ...row, token_hash: 'deadbeef' }) as Record<string, unknown>
    expect(info.token_hash).toBeUndefined()
    expect(info.token).toBeUndefined()
  })

  it('leaves account null while no account has claimed the device', () => {
    expect(toDeviceInfo(row).account).toBeNull()
  })

  it('surfaces the claiming account and its email', () => {
    const claimed = toDeviceInfo({ ...row, account_uuid: CLAIMED_ACCOUNT, account_email: 'thetechyhub@gmail.com' })
    expect(claimed.account).toEqual({ uuid: CLAIMED_ACCOUNT, email: 'thetechyhub@gmail.com' })
  })

  it('leaves email null on a claim that carried no address', () => {
    expect(toDeviceInfo({ ...row, account_uuid: CLAIMED_ACCOUNT }).account).toEqual({ uuid: CLAIMED_ACCOUNT, email: null })
  })

  it('leaves conflict null on the zero count the neon driver returns as a string', () => {
    expect(toDeviceInfo(row).conflict).toBeNull()
  })

  it('surfaces a conflict with its ISO timestamp and coerced count', () => {
    const rejected = toDeviceInfo({
      ...row,
      account_uuid: CLAIMED_ACCOUNT,
      rejected_account_uuid: OTHER_ACCOUNT,
      rejected_account_email: 'colleague@example.com',
      rejected_at: '2026-01-02T03:04:05Z',
      rejected_count: '3'
    })

    expect(rejected.conflict).toEqual({
      uuid: OTHER_ACCOUNT,
      email: 'colleague@example.com',
      at: '2026-01-02T03:04:05.000Z',
      count: 3
    })
  })

  it('leaves the conflict email null when the refused account carried no address', () => {
    const rejected = toDeviceInfo({
      ...row,
      account_uuid: CLAIMED_ACCOUNT,
      rejected_account_uuid: OTHER_ACCOUNT,
      rejected_at: '2026-01-02T03:04:05Z',
      rejected_count: '3'
    })

    expect(rejected.conflict).toEqual({ uuid: OTHER_ACCOUNT, email: null, at: '2026-01-02T03:04:05.000Z', count: 3 })
  })
})

describe('accountConflictError', () => {
  const PRESENTED_EMAIL = 'colleague@example.com'
  const presented = { uuid: OTHER_ACCOUNT, email: PRESENTED_EMAIL }

  function body(): string {
    const err = accountConflictError(CLAIMED_ACCOUNT, presented)
    return `${JSON.stringify(err)} ${err.message}`
  }

  it('is a 403 so an operator can tell a wrong account from a bad token', () => {
    expect(accountConflictError(CLAIMED_ACCOUNT, presented).statusCode).toBe(403)
  })

  it('leaks neither full uuid into the serialised body', () => {
    expect(body()).not.toContain(CLAIMED_ACCOUNT)
    expect(body()).not.toContain(OTHER_ACCOUNT)
    expect(body()).toContain(CLAIMED_ACCOUNT.slice(0, 8))
    expect(body()).toContain(OTHER_ACCOUNT.slice(0, 8))
  })

  it('leaks the presented email into neither the body nor the message', () => {
    expect(body()).not.toContain(PRESENTED_EMAIL)
  })
})

describe('setupCommand', () => {
  const ENDPOINT = 'https://example.vercel.app/api/otlp'
  const TOKEN = 'b087b4a3a3a4919cbb9b410c3a86d51a'

  it('needs no clone: it fetches the script over https and pipes it to bash', () => {
    const command = setupCommand(ENDPOINT, TOKEN)

    expect(command).toContain('curl -fsSL https://raw.githubusercontent.com/')
    expect(command).toContain('| bash -s --')
    expect(command).not.toContain('./scripts/')
  })

  it('carries both arguments through the pipe', () => {
    const command = setupCommand(ENDPOINT, TOKEN)

    expect(command).toContain(`--endpoint ${ENDPOINT}`)
    expect(command).toContain(`--token ${TOKEN}`)
  })

  /**
   * DeviceSecretCommand highlights and copies the token by slicing it off the
   * end, so a command that ends in anything else silently loses that button.
   */
  it('ends with the token', () => {
    expect(setupCommand(ENDPOINT, TOKEN).endsWith(TOKEN)).toBe(true)
    expect(setupCommand(ENDPOINT, TOKEN_PLACEHOLDER).endsWith(TOKEN_PLACEHOLDER)).toBe(true)
  })
})

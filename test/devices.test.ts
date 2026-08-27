import { describe, expect, it } from 'vitest'
import { compareDevices, deviceNameSchema, parseDeviceId, toDeviceInfo } from '../server/utils/deviceQueries'
import { deviceStatus } from '../server/utils/deviceToken'
import type { DeviceInfo, DeviceStatus } from '../shared/types'

const UUID = '9d5f5a3e-1c2b-4f7a-9e8d-6b7c8d9e0f1a'
const NAME_64 = 'a'.repeat(64)

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
    sessions: 0
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
    sessions: '0'
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
})

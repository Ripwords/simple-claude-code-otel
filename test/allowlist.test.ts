import { describe, expect, it } from 'vitest'
import { accountEmail, normalizeEmail, parseAllowedEmail, parseEmailParam } from '../server/utils/allowlistQueries'
import { decideAccount } from '../server/utils/deviceToken'
import type { AccountDecision } from '../server/utils/deviceToken'
import type { BatchAccount } from '../server/utils/otlp'

const CLAIMED_ACCOUNT = '11da1661-c0ff-46af-b748-a672c71d09c7'
const OTHER_ACCOUNT = '4c8b0d92-77ae-4a1f-9d63-0e2f5a1b8c40'

const OWNER: BatchAccount = { uuid: CLAIMED_ACCOUNT, email: 'thetechyhub@gmail.com' }
const GUEST: BatchAccount = { uuid: OTHER_ACCOUNT, email: 'colleague@example.com' }
const ANONYMOUS: BatchAccount = { uuid: OTHER_ACCOUNT, email: null }

interface Case {
  name: string
  claimed: string | null
  batch: BatchAccount | null
  allowed: boolean
  expected: AccountDecision
}

const CASES: Case[] = [
  {
    name: 'allows a batch with no account on an unclaimed device',
    claimed: null,
    batch: null,
    allowed: false,
    expected: { kind: 'allow' }
  },
  {
    name: 'allows a batch with no account on a claimed device, so a signed-out session is not dropped',
    claimed: CLAIMED_ACCOUNT,
    batch: null,
    allowed: false,
    expected: { kind: 'allow' }
  },
  {
    name: 'claims an unclaimed device for the account that first reported',
    claimed: null,
    batch: OWNER,
    allowed: false,
    expected: { kind: 'claim', account: OWNER }
  },
  {
    name: 'allows the account that already holds the claim',
    claimed: CLAIMED_ACCOUNT,
    batch: OWNER,
    allowed: false,
    expected: { kind: 'allow' }
  },
  {
    name: 'rejects a second account and carries the whole presented account',
    claimed: CLAIMED_ACCOUNT,
    batch: GUEST,
    allowed: false,
    expected: { kind: 'reject', claimed: CLAIMED_ACCOUNT, presented: GUEST }
  },
  {
    name: 'accepts a second account as a guest once its email is on the allowlist',
    claimed: CLAIMED_ACCOUNT,
    batch: GUEST,
    allowed: true,
    expected: { kind: 'guest', account: GUEST }
  },
  {
    name: 'rejects an account with no email and carries the null so the caller can record it',
    claimed: CLAIMED_ACCOUNT,
    batch: ANONYMOUS,
    allowed: false,
    expected: { kind: 'reject', claimed: CLAIMED_ACCOUNT, presented: ANONYMOUS }
  }
]

describe('decideAccount', () => {
  it.each(CASES)('$name', ({ claimed, batch, allowed, expected }) => {
    expect(decideAccount(claimed, batch, allowed)).toEqual(expected)
  })

  it('carries a null email through the reject arm', () => {
    const decision = decideAccount(CLAIMED_ACCOUNT, ANONYMOUS, false)
    expect(decision.kind === 'reject' && decision.presented.email).toBeNull()
  })
})

describe('parseAllowedEmail', () => {
  it('normalises the address it stores, so the allowlist compares like with like', () => {
    expect(parseAllowedEmail({ email: '  Colleague@Example.COM  ' })).toBe('colleague@example.com')
  })

  it.each([[{}], [{ email: '' }], [{ email: 'not-an-email' }], [{ email: `${'a'.repeat(250)}@example.com` }], ['colleague@example.com'], [null]])(
    'rejects %o with a 400',
    (input) => {
      expect(() => parseAllowedEmail(input)).toThrow(expect.objectContaining({ statusCode: 400 }))
    }
  )
})

describe('parseEmailParam', () => {
  it('normalises a route param', () => {
    expect(parseEmailParam('Colleague@Example.COM')).toBe('colleague@example.com')
  })

  it.each([[undefined], [''], ['not-an-email'], ['%'], ['a@b@c']])('rejects %o with a 400', (raw) => {
    expect(() => parseEmailParam(raw)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('normalizeEmail', () => {
  it('trims both ends and lowercases', () => {
    expect(normalizeEmail('  TheTechyHub@Gmail.COM \t')).toBe('thetechyhub@gmail.com')
  })

  it('is idempotent', () => {
    const once = normalizeEmail('  Colleague@Example.com  ')
    expect(normalizeEmail(once)).toBe(once)
  })
})

describe('accountEmail', () => {
  it('normalises a usable address off the wire', () => {
    expect(accountEmail('  Colleague@Example.com ')).toBe('colleague@example.com')
  })

  it('drops an address no allowlist entry could ever match', () => {
    expect(accountEmail(null)).toBeNull()
    expect(accountEmail('not an email')).toBeNull()
    expect(accountEmail(`${'a'.repeat(250)}@example.com`)).toBeNull()
  })
})

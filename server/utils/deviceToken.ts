import { createHash, randomBytes } from 'node:crypto'
import { createError } from 'h3'
import type { DeviceStatus } from '../../shared/types'
import type { BatchAccount } from './otlp'
import { accountEmail, isEmailAllowed } from './allowlistQueries'
import { db } from './db'

const TOKEN_BYTES = 24
const PREFIX_LENGTH = 8
const ACCOUNT_PREFIX_LENGTH = 8

export interface AuthenticatedDevice {
  id: string
  name: string
  accountUuid: string | null
}

export type AccountDecision
  = | { kind: 'allow' }
    | { kind: 'claim', account: BatchAccount }
    | { kind: 'guest', account: BatchAccount }
    | { kind: 'reject', claimed: string, presented: BatchAccount }

export function mintToken(): { token: string, hash: string, prefix: string } {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  return { token, hash: hashToken(token), prefix: token.slice(0, PREFIX_LENGTH) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function deviceStatus(firstSeen: Date | string | null, revokedAt: Date | string | null): DeviceStatus {
  if (revokedAt) return 'revoked'
  return firstSeen ? 'reporting' : 'pending'
}

export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

// Identity comes from the token, never from the payload. A device that presents a
// valid token IS that device, so a `device.name` attribute on the wire is ignored.
export async function authenticateDevice(header: string | undefined): Promise<AuthenticatedDevice> {
  const token = bearerToken(header)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const rows = await db().query(
    'select id, name, revoked_at, account_uuid from telemetry.device where token_hash = $1',
    [hashToken(token)]
  )

  const device = rows[0]
  if (!device || device.revoked_at) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  return { id: String(device.id), name: String(device.name), accountUuid: text(device.account_uuid) }
}

// Trust on first use, like an SSH host key: telemetry config lives in ~/.claude/settings.json,
// which is per machine, so the first account to report is the one this token means from then on.
// `allowed` is the global allowlist escape hatch, computed by the caller so this stays pure.
export function decideAccount(claimed: string | null, batch: BatchAccount | null, allowed: boolean): AccountDecision {
  if (!batch) return { kind: 'allow' }
  if (claimed === null) return { kind: 'claim', account: batch }
  if (claimed === batch.uuid) return { kind: 'allow' }
  if (allowed) return { kind: 'guest', account: batch }
  return { kind: 'reject', claimed, presented: batch }
}

// 403 rather than 401 so an operator reading the logs can tell "wrong account" from "bad token".
// Only uuid prefixes and never an email: the machine holder is not trusted with the other
// account's address, so that stays on the device row for the dashboard operator alone.
export function accountConflictError(claimed: string, presented: BatchAccount) {
  const claimedPrefix = claimed.slice(0, ACCOUNT_PREFIX_LENGTH)
  const presentedPrefix = presented.uuid.slice(0, ACCOUNT_PREFIX_LENGTH)
  return createError({
    statusCode: 403,
    statusMessage: 'Account mismatch',
    message: `This device token is claimed by Claude Code account ${claimedPrefix} and refuses telemetry from account ${presentedPrefix}.`,
    data: { claimed: claimedPrefix, presented: presentedPrefix }
  })
}

export async function enforceDeviceAccount(device: AuthenticatedDevice, batch: BatchAccount | null): Promise<void> {
  let claimed = device.accountUuid
  let decision = decideAccount(claimed, batch, false)

  if (decision.kind === 'claim') {
    const won = await db().query(
      'update telemetry.device set account_uuid = $2, account_email = $3 where id = $1::uuid and account_uuid is null returning account_uuid',
      [device.id, decision.account.uuid, decision.account.email]
    )
    if (won[0]) return

    // Zero rows means a concurrent first batch won the claim, so the stored value decides.
    const stored = await db().query('select account_uuid from telemetry.device where id = $1::uuid', [device.id])
    claimed = text(stored[0]?.account_uuid)
    decision = decideAccount(claimed, batch, false)
  }

  // Looked up only where it can change the outcome, so a matching account stays a single query.
  if (decision.kind === 'reject' && await isEmailAllowed(accountEmail(decision.presented.email))) {
    decision = decideAccount(claimed, batch, true)
  }

  if (decision.kind === 'guest') {
    // The stored conflict would otherwise keep telling the operator that none of this account's
    // telemetry entered the data while it is in fact landing. Scoped to the guest's own uuid, so
    // a third account's refusal is still waiting for the operator when it is the one on record.
    await db().query(
      `update telemetry.device set rejected_account_uuid = null, rejected_account_email = null,
       rejected_at = null, rejected_count = 0 where id = $1::uuid and rejected_account_uuid = $2`,
      [device.id, decision.account.uuid]
    )
    return
  }

  if (decision.kind !== 'reject') return

  // Recorded even though the batch is refused: it is the only reason the dashboard can
  // explain why a machine went quiet.
  await db().query(
    `update telemetry.device set rejected_account_uuid = $2, rejected_account_email = $3,
     rejected_at = now(), rejected_count = rejected_count + 1 where id = $1::uuid`,
    [device.id, decision.presented.uuid, accountEmail(decision.presented.email)]
  )
  throw accountConflictError(decision.claimed, decision.presented)
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

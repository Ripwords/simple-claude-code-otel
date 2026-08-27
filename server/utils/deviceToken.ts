import { createHash, randomBytes } from 'node:crypto'
import { createError } from 'h3'
import type { DeviceStatus } from '../../shared/types'
import type { BatchAccount } from './otlp'
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
    | { kind: 'reject', claimed: string, presented: string }

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
export function decideAccount(claimed: string | null, batch: BatchAccount | null): AccountDecision {
  if (!batch) return { kind: 'allow' }
  if (claimed === null) return { kind: 'claim', account: batch }
  if (claimed === batch.uuid) return { kind: 'allow' }
  return { kind: 'reject', claimed, presented: batch.uuid }
}

// 403 rather than 401 so an operator reading the logs can tell "wrong account" from "bad token",
// and only uuid prefixes so refusing one account never discloses the other to the machine holder.
export function accountConflictError(claimed: string, presented: string) {
  const claimedPrefix = claimed.slice(0, ACCOUNT_PREFIX_LENGTH)
  const presentedPrefix = presented.slice(0, ACCOUNT_PREFIX_LENGTH)
  return createError({
    statusCode: 403,
    statusMessage: 'Account mismatch',
    message: `This device token is claimed by Claude Code account ${claimedPrefix} and refuses telemetry from account ${presentedPrefix}.`,
    data: { claimed: claimedPrefix, presented: presentedPrefix }
  })
}

export async function enforceDeviceAccount(device: AuthenticatedDevice, batch: BatchAccount | null): Promise<void> {
  let decision = decideAccount(device.accountUuid, batch)

  if (decision.kind === 'claim') {
    const claimed = await db().query(
      'update telemetry.device set account_uuid = $2, account_email = $3 where id = $1::uuid and account_uuid is null returning account_uuid',
      [device.id, decision.account.uuid, decision.account.email]
    )
    if (claimed[0]) return

    // Zero rows means a concurrent first batch won the claim, so the stored value decides.
    const stored = await db().query('select account_uuid from telemetry.device where id = $1::uuid', [device.id])
    decision = decideAccount(text(stored[0]?.account_uuid), batch)
  }

  if (decision.kind !== 'reject') return

  // Recorded even though the batch is refused: it is the only reason the dashboard can
  // explain why a machine went quiet.
  await db().query(
    'update telemetry.device set rejected_account_uuid = $2, rejected_at = now(), rejected_count = rejected_count + 1 where id = $1::uuid',
    [device.id, decision.presented]
  )
  throw accountConflictError(decision.claimed, decision.presented)
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

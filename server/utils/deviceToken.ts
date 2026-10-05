import { createHash, randomBytes } from 'node:crypto'
import { createError } from 'h3'
import type { DeviceStatus } from '../../shared/types'
import type { BatchAccount, Statement } from './otlp'
import { accountEmail, isEmailAllowed } from './allowlistQueries'
import { cachedDevice, forgetDevice, updateCachedDevice } from './deviceCache'
import { enqueue, redis } from './buffer'
import { db } from './db'

const TOKEN_BYTES = 24
const PREFIX_LENGTH = 8
const ACCOUNT_PREFIX_LENGTH = 8

export interface AuthenticatedDevice {
  id: string
  name: string
  tokenHash: string
  accountUuid: string | null
  /** The account whose telemetry was last refused, while that refusal is still standing. */
  refusedAccountUuid: string | null
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

  const tokenHash = hashToken(token)
  const device = await cachedDevice(tokenHash, async () => {
    const rows = await db().query(
      'select id, name, revoked_at, account_uuid, rejected_account_uuid, rejected_count from telemetry.device where token_hash = $1',
      [tokenHash]
    )
    const row = rows[0]
    if (!row || row.revoked_at) return null
    return {
      id: String(row.id),
      name: String(row.name),
      accountUuid: text(row.account_uuid),
      refusedAccountUuid: Number(row.rejected_count ?? 0) > 0 ? text(row.rejected_account_uuid) : null
    }
  })

  if (!device) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return { ...device, tokenHash }
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
    await forgetDevice(device.tokenHash)
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

  // A stored refusal is a live claim that this machine is contributing nothing, so it cannot
  // outlive the batch that disproves it. The owner signing back in is the commonest way out of
  // a conflict and used to leave the dashboard warning about a machine that had long resumed.
  // A guest clears only its own refusal, so a third account's is still waiting for the operator.
  // Both are decided from the cached device, so a machine with nothing to clear writes nothing.
  if (batch && (decision.kind === 'allow' || decision.kind === 'guest')) {
    const refused = device.refusedAccountUuid
    const clears = decision.kind === 'allow' ? refused !== null : refused === decision.account.uuid
    if (clears) await writeRefusal(device, clearConflict(device.id, decision.kind === 'guest' ? decision.account.uuid : null), null)
    return
  }

  if (decision.kind !== 'reject') return

  // Recorded even though the batch is refused: it is the only reason the dashboard can
  // explain why a machine went quiet. A refused machine keeps posting every minute, so with
  // Redis the record joins the ingest queue rather than waking Postgres on every attempt.
  await writeRefusal(device, {
    text: `update telemetry.device set rejected_account_uuid = $2, rejected_account_email = $3,
     rejected_at = now(), rejected_count = rejected_count + 1 where id = $1::uuid`,
    params: [device.id, decision.presented.uuid, accountEmail(decision.presented.email)]
  }, decision.presented.uuid)
  throw accountConflictError(decision.claimed, decision.presented)
}

function clearConflict(deviceId: string, onlyFor: string | null): Statement {
  return {
    text: `update telemetry.device set rejected_account_uuid = null, rejected_account_email = null,
     rejected_at = null, rejected_count = 0
     where id = $1::uuid and ($2::text is null or rejected_account_uuid = $2)`,
    params: [deviceId, onlyFor]
  }
}

/**
 * Records or clears a refusal. With Redis both go through the ingest queue -- never one queued
 * and one direct, or a clear could land ahead of an older queued refusal and be undone by it --
 * and the cached device is updated in place so the next batch decides without Postgres.
 */
async function writeRefusal(device: AuthenticatedDevice, statement: Statement, refusedAccountUuid: string | null): Promise<void> {
  const store = redis()
  if (!store) {
    await db().query(statement.text, statement.params)
    return
  }
  await enqueue(store, [statement])
  const { tokenHash, ...cached } = device
  await updateCachedDevice(tokenHash, cached, { ...cached, refusedAccountUuid })
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

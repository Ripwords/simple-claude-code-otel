import { createError } from 'h3'
import { z } from 'zod'
import type { DeviceAccount, DeviceAccountConflict, DeviceCascade, DeviceInfo, DeviceSecret, DeviceStatus } from '../../shared/types'
import { deviceStatus, mintToken } from './deviceToken'
import { db } from './db'

const UNIQUE_VIOLATION = '23505'

const DEVICE_COLUMNS = `d.id, d.name, d.token_prefix, d.created_at, d.first_seen, d.last_seen_at, d.revoked_at,
  d.account_uuid, d.account_email, d.rejected_account_uuid, d.rejected_at, d.rejected_count,
  (select count(*) from telemetry.session s where s.device_id = d.id) as sessions`

export const deviceNameSchema = z.string().trim().min(1).max(64)

export const bodyNameSchema = z.object({ name: deviceNameSchema })

export const STATUS_RANK: Record<DeviceStatus, number> = { pending: 0, reporting: 1, revoked: 2 }

export function parseDeviceName(input: unknown): string {
  const parsed = bodyNameSchema.safeParse(input)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid device name', data: z.treeifyError(parsed.error) })
  }
  return parsed.data.name
}

export function parseDeviceId(raw: string | undefined): string {
  const parsed = z.uuid().safeParse(raw)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid device id' })
  return parsed.data
}

export function toDeviceInfo(row: Record<string, unknown>): DeviceInfo {
  const firstSeen = timestamp(row.first_seen)
  const revokedAt = timestamp(row.revoked_at)
  return {
    id: String(row.id),
    name: String(row.name),
    tokenPrefix: String(row.token_prefix),
    status: deviceStatus(firstSeen, revokedAt),
    createdAt: new Date(String(row.created_at)).toISOString(),
    firstSeen,
    lastSeen: timestamp(row.last_seen_at),
    revokedAt,
    sessions: Number(row.sessions ?? 0),
    account: toAccount(row),
    conflict: toConflict(row)
  }
}

export function compareDevices(a: DeviceInfo, b: DeviceInfo): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name)
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const rows = await db().query(`select ${DEVICE_COLUMNS} from telemetry.device d`, [])
  return rows.map(toDeviceInfo).sort(compareDevices)
}

export async function createDevice(name: string): Promise<DeviceSecret> {
  const { token, hash, prefix } = mintToken()
  const rows = await uniqueName(() => db().query(
    `with inserted as (insert into telemetry.device (name, token_hash, token_prefix) values ($1, $2, $3) returning *)
     select ${DEVICE_COLUMNS} from inserted d`,
    [name, hash, prefix]
  ))
  return { device: toDeviceInfo(found(rows)), token }
}

export async function renameDevice(id: string, name: string): Promise<DeviceInfo> {
  const rows = await uniqueName(() => db().query(
    `with updated as (update telemetry.device set name = $2 where id = $1 returning *)
     select ${DEVICE_COLUMNS} from updated d`,
    [id, name]
  ))
  return toDeviceInfo(found(rows))
}

// Rotation clears revoked_at: issuing a fresh credential to a machine is the act of
// putting it back into service, so leaving it revoked would hand out a dead token.
export async function rotateDevice(id: string): Promise<DeviceSecret> {
  const { token, hash, prefix } = mintToken()
  const rows = await db().query(
    `with updated as (update telemetry.device set token_hash = $2, token_prefix = $3, revoked_at = null where id = $1 returning *)
     select ${DEVICE_COLUMNS} from updated d`,
    [id, hash, prefix]
  )
  return { device: toDeviceInfo(found(rows)), token }
}

export async function revokeDevice(id: string): Promise<DeviceInfo> {
  const rows = await db().query(
    `with updated as (update telemetry.device set revoked_at = coalesce(revoked_at, now()) where id = $1 returning *)
     select ${DEVICE_COLUMNS} from updated d`,
    [id]
  )
  return toDeviceInfo(found(rows))
}

// Releasing re-arms trust on first use, so the next account to report claims the machine.
export async function releaseDevice(id: string): Promise<DeviceInfo> {
  const rows = await db().query(
    `with updated as (update telemetry.device set account_uuid = null, account_email = null,
       rejected_account_uuid = null, rejected_at = null, rejected_count = 0 where id = $1 returning *)
     select ${DEVICE_COLUMNS} from updated d`,
    [id]
  )
  return toDeviceInfo(found(rows))
}

export async function deleteDevice(id: string): Promise<DeviceCascade> {
  const rows = await db().query(
    `with counts as (
      select
        (select count(*) from telemetry.session where device_id = $1) as sessions,
        (select count(*) from telemetry.metric_point where device_id = $1) as metric_points,
        (select count(*) from telemetry.event where device_id = $1) as events
    ),
    deleted as (delete from telemetry.device where id = $1 returning 1)
    select counts.sessions, counts.metric_points, counts.events, (select count(*) from deleted) as devices from counts`,
    [id]
  )

  const row = found(rows)
  if (Number(row.devices ?? 0) === 0) throw notFound()

  return {
    sessions: Number(row.sessions ?? 0),
    metricPoints: Number(row.metric_points ?? 0),
    events: Number(row.events ?? 0)
  }
}

async function uniqueName(run: () => Promise<Record<string, unknown>[]>): Promise<Record<string, unknown>[]> {
  try {
    return await run()
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === UNIQUE_VIOLATION) {
      throw createError({ statusCode: 409, statusMessage: 'A device with that name already exists' })
    }
    throw err
  }
}

function found(rows: Record<string, unknown>[]): Record<string, unknown> {
  const row = rows[0]
  if (!row) throw notFound()
  return row
}

function notFound() {
  return createError({ statusCode: 404, statusMessage: 'Device not found' })
}

function toAccount(row: Record<string, unknown>): DeviceAccount | null {
  const uuid = row.account_uuid
  if (uuid === null || uuid === undefined) return null
  const email = row.account_email
  return { uuid: String(uuid), email: email === null || email === undefined ? null : String(email) }
}

function toConflict(row: Record<string, unknown>): DeviceAccountConflict | null {
  const count = Number(row.rejected_count ?? 0)
  const at = timestamp(row.rejected_at)
  if (count === 0 || at === null) return null
  return { uuid: String(row.rejected_account_uuid), at, count }
}

function timestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string).toISOString()
}

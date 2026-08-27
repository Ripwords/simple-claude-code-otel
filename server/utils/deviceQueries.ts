import { createError } from 'h3'
import { z } from 'zod'
import type { DeviceInfo, DeviceSecret, DeviceStatus } from '../../shared/types'
import { deviceStatus, mintToken } from './deviceToken'
import { db } from './db'

const UNIQUE_VIOLATION = '23505'

const DEVICE_COLUMNS = `d.id, d.name, d.token_prefix, d.created_at, d.first_seen, d.last_seen_at, d.revoked_at,
  (select count(*) from telemetry.session s where s.device_id = d.id) as sessions`

export interface DeviceCascade {
  sessions: number
  metricPoints: number
  events: number
}

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
  return {
    id: String(row.id),
    name: String(row.name),
    tokenPrefix: String(row.token_prefix),
    status: deviceStatus(timestamp(row.first_seen), timestamp(row.revoked_at)),
    createdAt: new Date(String(row.created_at)).toISOString(),
    firstSeen: timestamp(row.first_seen),
    lastSeen: timestamp(row.last_seen_at),
    sessions: Number(row.sessions ?? 0)
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

function timestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string).toISOString()
}

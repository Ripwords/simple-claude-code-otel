import { createHash, randomBytes } from 'node:crypto'
import type { DeviceStatus } from '../../shared/types'

const TOKEN_BYTES = 24
const PREFIX_LENGTH = 8

export interface AuthenticatedDevice {
  id: string
  name: string
}

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
    'select id, name, revoked_at from telemetry.device where token_hash = $1',
    [hashToken(token)]
  )

  const device = rows[0]
  if (!device || device.revoked_at) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  return { id: String(device.id), name: String(device.name) }
}

import type { DeviceInfo, DeviceStatus } from '#shared/types'

export const DEVICE_ACTIONS = ['rename', 'rotate', 'revoke', 'delete'] as const
export type DeviceAction = (typeof DEVICE_ACTIONS)[number]

export const ACTION: Record<DeviceAction, { label: string, aria: (name: string) => string }> = {
  rename: { label: 'Rename', aria: n => `Rename ${n}` },
  rotate: { label: 'Rotate', aria: n => `Rotate token for ${n}` },
  revoke: { label: 'Revoke', aria: n => `Revoke token for ${n}` },
  delete: { label: 'Delete', aria: n => `Delete ${n} and all of its history` }
}

export type StatusMark = 'ring' | 'disc' | 'barred'

interface StatusMeta {
  readonly word: string
  readonly line: string
  readonly mark: StatusMark
  readonly order: number
  readonly hasSeries: boolean
  readonly ruled: boolean
  readonly setup: boolean
  readonly rotateWarning: (name: string) => string
  readonly actions: readonly DeviceAction[]
}

export const STATUS = {
  pending: {
    word: 'Pending',
    line: 'No telemetry yet. Run the setup command on this machine.',
    mark: 'ring',
    order: 0,
    hasSeries: false,
    ruled: true,
    setup: true,
    rotateWarning: (name: string) => `${name} has never reported, so nothing breaks. Rotating replaces the token you can no longer see with one you can.`,
    actions: ['rename', 'rotate', 'revoke', 'delete']
  },
  reporting: {
    word: 'Reporting',
    line: 'Telemetry is arriving. Its numbers are in every chart.',
    mark: 'disc',
    order: 1,
    hasSeries: true,
    ruled: false,
    setup: false,
    rotateWarning: (name: string) => `The current token dies the moment the new one is minted. ${name} reports nothing until you run the new command on it.`,
    actions: ['rename', 'rotate', 'revoke', 'delete']
  },
  revoked: {
    word: 'Revoked',
    line: 'Ingest is refused. Its history is kept and still charted. Rotating a new token puts it back into service.',
    mark: 'barred',
    order: 2,
    hasSeries: true,
    ruled: false,
    setup: false,
    rotateWarning: (name: string) => `Rotating puts ${name} back into service. Ingest resumes as soon as you run the new command on it.`,
    actions: ['rename', 'rotate', 'delete']
  }
} as const satisfies Record<DeviceStatus, StatusMeta>

export type SecretReason = 'minted' | 'rotated'

export interface RowPane {
  action: DeviceAction
  device: DeviceInfo
}

export type PanelResult
  = | { action: 'rename', name: string }
    | { action: 'rotate' | 'revoke' | 'delete' }

export const DEVICE_NAME_MAX = 64

export const TOKEN_PLACEHOLDER = '<token>'

export function setupCommand(otlpEndpoint: string, token: string): string {
  return `./scripts/setup-device.sh --endpoint ${otlpEndpoint} --token ${token}`
}

export function sortDevices(devices: DeviceInfo[]): DeviceInfo[] {
  return [...devices].sort((a, b) =>
    STATUS[a.status].order - STATUS[b.status].order || a.name.localeCompare(b.name))
}

export function nameProblem(raw: string, roster: DeviceInfo[], selfId?: string): string | null {
  const name = raw.trim()
  if (name.length === 0) return 'Give the machine a name. It is the label on every row and every chart.'
  if (name.length > DEVICE_NAME_MAX) return `That is ${name.length} characters. Keep it to ${DEVICE_NAME_MAX}.`

  const clash = roster.find(device => device.id !== selfId && device.name.toLowerCase() === name.toLowerCase())
  if (clash) return `${clash.name} already exists. Two machines cannot share a name.`

  return null
}

/** The server owns the field names in a deletion result, so they are read as they arrive. */
export function humaniseCount(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

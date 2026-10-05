import type { BreakdownRow } from '#shared/types'

// Buckets the breakdown query emits that are not a model and must never take a rank.
const NOT_A_MODEL = new Set(['Other', 'unknown'])

export interface RankedModel {
  model: string
  value: number
  /** Of everything the machine spent or used in the range, including Other. */
  share: number
}

export interface MachineTopModels {
  deviceId: string
  device: string
  total: number
  models: RankedModel[]
}

/**
 * The top `limit` models per machine. The share is taken against the machine's whole total so
 * that three ranked models covering 80% of spend read as 80%, not as a renormalised 100%.
 * Machines with nothing in the range are left out rather than shown as a row of dashes.
 */
export function rankTopModels(rows: readonly BreakdownRow[], limit = 3): MachineTopModels[] {
  const machines = new Map<string, MachineTopModels>()
  for (const row of rows) {
    let machine = machines.get(row.deviceId)
    if (!machine) {
      machine = { deviceId: row.deviceId, device: row.device, total: 0, models: [] }
      machines.set(row.deviceId, machine)
    }
    machine.total += row.value
    if (!NOT_A_MODEL.has(row.key)) machine.models.push({ model: row.key, value: row.value, share: 0 })
  }

  return [...machines.values()]
    .filter(machine => machine.total > 0)
    .map(machine => ({
      ...machine,
      models: machine.models
        .filter(model => model.value > 0)
        .sort((a, b) => b.value - a.value || a.model.localeCompare(b.model))
        .slice(0, limit)
        .map(model => ({ ...model, share: model.value / machine.total }))
    }))
    .sort((a, b) => a.device.localeCompare(b.device))
}

/** `claude-opus-4-8-20260714` reads as `opus 4.8`; anything unrecognised is shown as sent. */
export function shortModelName(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(.*)$/.exec(model)
  if (!match) return model
  const [, family, major, minor, rest] = match
  return `${family} ${major}${minor ? `.${minor}` : ''}${rest ?? ''}`
}

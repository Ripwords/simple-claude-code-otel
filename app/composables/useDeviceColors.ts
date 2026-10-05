import type { DeviceInfo } from '#shared/types'

export const SERIES_SLOT_COUNT = 8

export interface DeviceColor {
  deviceId: string
  slot: number
  color: string
}

/**
 * Slots are keyed on the immutable device id, never on the name, so renaming a
 * machine keeps its colour everywhere. They are derived from the full roster
 * rather than the filtered selection, so narrowing the filter or the range
 * leaves every colour untouched.
 *
 * The palette holds eight hues and cycling it would give a ninth machine the same
 * colour as the first, which reads as one machine rather than two. Past eight,
 * machines take neutral ink and are identified by their label instead -- so the
 * eight hues go to the machines most worth telling apart: reporting ones first,
 * busiest first, id as the tie-break. Handing them out by id alone gave colours to
 * revoked and never-used machines while the busiest ones drew grey.
 */
function assign(devices: DeviceInfo[]): Map<string, DeviceColor> {
  const ordered = [...devices].sort((a, b) =>
    Number(b.status === 'reporting') - Number(a.status === 'reporting')
    || b.sessions - a.sessions
    || a.id.localeCompare(b.id))

  return new Map(ordered.slice(0, SERIES_SLOT_COUNT).map((device, index) => {
    const slot = index + 1
    return [device.id, { deviceId: device.id, slot, color: `var(--viz-series-${slot})` }]
  }))
}

export function useDeviceColors() {
  const { data } = useDevices()

  const table = computed(() => assign(data.value ?? []))

  function colorFor(deviceId: string): string {
    return table.value.get(deviceId)?.color ?? 'var(--viz-muted)'
  }

  function slotFor(deviceId: string): number {
    return table.value.get(deviceId)?.slot ?? 0
  }

  return { table, colorFor, slotFor }
}

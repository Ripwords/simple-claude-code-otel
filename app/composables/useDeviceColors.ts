import type { DeviceInfo } from '#shared/types'
import { UNLABELLED_DEVICE } from '#shared/types'

export const SERIES_SLOT_COUNT = 8

export interface DeviceColor {
  device: string
  slot: number
  color: string
}

/**
 * The categorical palette encodes identity, and the unlabelled bucket is the
 * absence of one, so it takes neutral ink instead of a hue. Painting it like a
 * machine would claim an identity it does not have, and would let a
 * misconfiguration compete with the real machines for attention.
 */
function assign(devices: string[]): Map<string, DeviceColor> {
  const named = devices.filter(device => device !== UNLABELLED_DEVICE).sort((a, b) => a.localeCompare(b))

  const table = new Map<string, DeviceColor>(named.map((device, index) => {
    const slot = (index % SERIES_SLOT_COUNT) + 1
    return [device, { device, slot, color: `var(--viz-series-${slot})` }]
  }))

  if (devices.includes(UNLABELLED_DEVICE)) {
    table.set(UNLABELLED_DEVICE, { device: UNLABELLED_DEVICE, slot: 0, color: 'var(--viz-baseline)' })
  }

  return table
}

/**
 * Slots are derived from the full device roster, never from the filtered
 * selection, so narrowing the filter leaves the survivor's colour untouched.
 */
export function useDeviceColors() {
  const { data } = useDevices()

  const table = computed(() => assign((data.value ?? []).map((d: DeviceInfo) => d.device)))

  function colorFor(device: string): string {
    return table.value.get(device)?.color ?? 'var(--viz-muted)'
  }

  function slotFor(device: string): number {
    return table.value.get(device)?.slot ?? 0
  }

  return { table, colorFor, slotFor }
}

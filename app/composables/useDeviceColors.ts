import type { DeviceInfo } from '#shared/types'

export const SERIES_SLOT_COUNT = 8

export interface DeviceColor {
  device: string
  slot: number
  color: string
}

function assign(devices: string[]): Map<string, DeviceColor> {
  const sorted = [...devices].sort((a, b) => a.localeCompare(b))
  return new Map(sorted.map((device, index) => {
    const slot = (index % SERIES_SLOT_COUNT) + 1
    return [device, { device, slot, color: `var(--viz-series-${slot})` }]
  }))
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

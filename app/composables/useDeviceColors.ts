export const SERIES_SLOT_COUNT = 8

export interface DeviceColor {
  deviceId: string
  slot: number
  color: string
}

/**
 * Slots are keyed on the immutable device id, never on the name, so renaming a
 * machine keeps its colour everywhere. They are derived from the full roster
 * rather than the filtered selection, so narrowing the filter leaves the
 * survivor's colour untouched.
 */
function assign(deviceIds: string[]): Map<string, DeviceColor> {
  const ordered = [...deviceIds].sort((a, b) => a.localeCompare(b))

  // The palette holds eight hues and cycling it would give a ninth machine the same
  // colour as the first, which reads as one machine rather than two. Past eight,
  // machines take neutral ink and are identified by their label instead.
  return new Map(ordered.slice(0, SERIES_SLOT_COUNT).map((deviceId, index) => {
    const slot = index + 1
    return [deviceId, { deviceId, slot, color: `var(--viz-series-${slot})` }]
  }))
}

export function useDeviceColors() {
  const { data } = useDevices()

  const table = computed(() => assign((data.value ?? []).map(device => device.id)))

  function colorFor(deviceId: string): string {
    return table.value.get(deviceId)?.color ?? 'var(--viz-muted)'
  }

  function slotFor(deviceId: string): number {
    return table.value.get(deviceId)?.slot ?? 0
  }

  return { table, colorFor, slotFor }
}

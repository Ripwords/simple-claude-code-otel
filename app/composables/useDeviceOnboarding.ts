import type { DeviceInfo } from '#shared/types'

/**
 * The three onboarding fields are optional on the wire: an older server build
 * omits them, and every check here is falsy in that case, so the surface simply
 * does not appear rather than throwing.
 */
export function useDeviceOnboarding() {
  const { data } = useDevices()

  const pendingDevice = ref<string | null>(null)
  const failures = ref<Record<string, string>>({})

  const arrivals = computed(() => (data.value ?? []).filter(d => d.isNew && !d.isUnlabelled))
  const unlabelled = computed(() => (data.value ?? []).filter(d => d.isUnlabelled))

  function describe(device: string, error: unknown): string {
    const failure = error as { statusCode?: number, status?: number, statusMessage?: string }
    const status = failure?.statusCode ?? failure?.status

    if (status === 404 && failure?.statusMessage === 'Unknown device') {
      return `The dashboard no longer lists ${device}, so it cannot be dismissed. Reload to refresh the machine list.`
    }
    if (status === 404) {
      return `This dashboard has no /api/devices/acknowledge route, so ${device} stays listed here.`
    }
    if (status === undefined) {
      return `The request to /api/devices/acknowledge never completed, so ${device} stays listed here.`
    }
    return `/api/devices/acknowledge answered ${status}, so ${device} stays listed here.`
  }

  async function acknowledge(device: string) {
    pendingDevice.value = device
    const { [device]: _dropped, ...rest } = failures.value
    failures.value = rest

    try {
      const updated = await $fetch<DeviceInfo>('/api/devices/acknowledge', { method: 'POST', body: { device } })
      data.value = (data.value ?? []).map(entry => entry.device === device ? updated : entry)
    } catch (error) {
      failures.value = { ...failures.value, [device]: describe(device, error) }
    } finally {
      pendingDevice.value = null
    }
  }

  return { arrivals, unlabelled, acknowledge, pendingDevice, failures }
}

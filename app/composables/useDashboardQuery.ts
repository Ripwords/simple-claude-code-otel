import type { Bucket } from '#shared/types'

export type RangePresetId = 'today' | '7d' | '30d' | '90d'

export interface RangePreset {
  id: RangePresetId
  label: string
  bucket: Bucket
  days: number
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: 'today', label: 'Today', bucket: 'hour', days: 0 },
  { id: '7d', label: 'Last 7 days', bucket: 'day', days: 6 },
  { id: '30d', label: 'Last 30 days', bucket: 'day', days: 29 },
  { id: '90d', label: 'Last 90 days', bucket: 'day', days: 89 }
]

const DEFAULT_PRESET: RangePresetId = '7d'

function resolvePreset(id: string | undefined): RangePreset {
  return RANGE_PRESETS.find(p => p.id === id) ?? RANGE_PRESETS.find(p => p.id === DEFAULT_PRESET)!
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function useDashboardQuery() {
  const route = useRoute()
  const router = useRouter()
  const now = ref(Date.now())

  const preset = computed(() => resolvePreset(route.query.range as string | undefined))

  const selectedDevices = computed<string[]>(() => {
    const raw = route.query.devices
    if (typeof raw !== 'string' || raw.length === 0) return []
    return raw.split(',').filter(Boolean)
  })

  const range = computed(() => {
    const end = new Date(now.value)
    const start = startOfDay(new Date(end.getTime() - preset.value.days * 86_400_000))
    return { from: start.toISOString(), to: end.toISOString() }
  })

  const rangeQuery = computed(() => ({
    from: range.value.from,
    to: range.value.to,
    ...(selectedDevices.value.length > 0 ? { devices: selectedDevices.value } : {})
  }))

  function setPreset(id: RangePresetId) {
    now.value = Date.now()
    router.replace({ query: { ...route.query, range: id } })
  }

  function setDevices(devices: string[]) {
    const query = { ...route.query }
    if (devices.length === 0) {
      delete query.devices
    } else {
      query.devices = devices.join(',')
    }
    router.replace({ query })
  }

  return { preset, selectedDevices, range, rangeQuery, bucket: computed(() => preset.value.bucket), setPreset, setDevices }
}

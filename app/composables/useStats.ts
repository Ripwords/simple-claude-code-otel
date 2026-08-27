import type { Bucket, BreakdownRow, DeviceInfo, DeviceSummary, MetricKey, SeriesPoint } from '#shared/types'

export type BreakdownDimension = 'model' | 'toolName' | 'tokenType' | 'editDecision' | 'errorStatus'

export interface RangeParams {
  from: string
  to: string
  devices?: string[]
}

type FixtureMode = 'off' | 'data' | 'empty'

function useFixtureMode() {
  const route = useRoute()
  return computed<FixtureMode>(() => {
    if (!import.meta.dev || route.query.fixture === undefined) return 'off'
    return route.query.fixture === 'empty' ? 'empty' : 'data'
  })
}

export function useDevices() {
  const fixture = useFixtureMode()
  return useAsyncData<DeviceInfo[]>(
    'stats:devices',
    () => {
      if (fixture.value === 'empty') return Promise.resolve([])
      if (fixture.value === 'data') return Promise.resolve(fixtureDevices())
      return $fetch<DeviceInfo[]>('/api/stats/devices')
    },
    { default: () => [], watch: [fixture] }
  )
}

export function useSummary(params: Ref<RangeParams>) {
  const fixture = useFixtureMode()
  return useAsyncData<DeviceSummary[]>(
    'stats:summary',
    () => {
      if (fixture.value === 'empty') return Promise.resolve([])
      if (fixture.value === 'data') return Promise.resolve(fixtureSummary(params.value.devices ?? []))
      return $fetch<DeviceSummary[]>('/api/stats/summary', { query: params.value })
    },
    { default: () => [], watch: [params, fixture] }
  )
}

export function useTimeseries(params: Ref<RangeParams>, metric: MetricKey, bucket: Ref<Bucket>) {
  const fixture = useFixtureMode()
  return useAsyncData<SeriesPoint[]>(
    `stats:timeseries:${metric}`,
    () => {
      if (fixture.value === 'empty') return Promise.resolve([])
      if (fixture.value === 'data') return Promise.resolve(fixtureTimeseries(params.value.devices ?? [], metric, bucket.value))
      return $fetch<SeriesPoint[]>('/api/stats/timeseries', { query: { ...params.value, metric, bucket: bucket.value } })
    },
    { default: () => [], watch: [params, bucket, fixture] }
  )
}

export function useBreakdown(params: Ref<RangeParams>, by: BreakdownDimension) {
  const fixture = useFixtureMode()
  return useAsyncData<BreakdownRow[]>(
    `stats:breakdown:${by}`,
    () => {
      if (fixture.value === 'empty') return Promise.resolve([])
      if (fixture.value === 'data') return Promise.resolve(fixtureBreakdown(params.value.devices ?? [], by))
      return $fetch<BreakdownRow[]>('/api/stats/breakdown', { query: { ...params.value, by } })
    },
    { default: () => [], watch: [params, fixture] }
  )
}

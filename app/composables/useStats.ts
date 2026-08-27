import type { Bucket, BreakdownRow, DeviceSummary, MetricKey, SeriesPoint } from '#shared/types'

export type BreakdownDimension = 'model' | 'toolName' | 'tokenType' | 'editDecision' | 'errorStatus'

function splitDevices(raw: string | undefined): string[] {
  return raw ? raw.split(',').filter(Boolean) : []
}

export interface RangeParams {
  from: string
  to: string
  devices?: string
}

export function useSummary(params: Ref<RangeParams>) {
  const fixture = useFixtureMode()
  const request = useRequestFetch()
  return useAsyncData<DeviceSummary[]>(
    'stats:summary',
    () => {
      if (fixture.value === 'empty') return Promise.resolve([])
      if (fixture.value === 'data') return Promise.resolve(fixtureSummary(splitDevices(params.value.devices)))
      return request<DeviceSummary[]>('/api/stats/summary', { query: params.value })
    },
    { default: () => [], watch: [params, fixture] }
  )
}

export function useTimeseries(params: Ref<RangeParams>, metric: MetricKey, bucket: Ref<Bucket>) {
  const fixture = useFixtureMode()
  const request = useRequestFetch()
  return useAsyncData<SeriesPoint[]>(
    `stats:timeseries:${metric}`,
    () => {
      if (fixture.value === 'empty') return Promise.resolve([])
      if (fixture.value === 'data') return Promise.resolve(fixtureTimeseries(splitDevices(params.value.devices), metric, bucket.value))
      return request<SeriesPoint[]>('/api/stats/timeseries', { query: { ...params.value, metric, bucket: bucket.value } })
    },
    { default: () => [], watch: [params, bucket, fixture] }
  )
}

export function useBreakdown(params: Ref<RangeParams>, by: BreakdownDimension) {
  const fixture = useFixtureMode()
  const request = useRequestFetch()
  return useAsyncData<BreakdownRow[]>(
    `stats:breakdown:${by}`,
    () => {
      if (fixture.value === 'empty') return Promise.resolve([])
      if (fixture.value === 'data') return Promise.resolve(fixtureBreakdown(splitDevices(params.value.devices), by))
      return request<BreakdownRow[]>('/api/stats/breakdown', { query: { ...params.value, by } })
    },
    { default: () => [], watch: [params, fixture] }
  )
}

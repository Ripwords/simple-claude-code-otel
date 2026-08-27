<script setup lang="ts">
import type { BreakdownRow, DeviceSummary, SeriesPoint } from '#shared/types'
import type { ChartBarGroup, ChartSeries } from '~/utils/viz'

const { rangeQuery, bucket } = useDashboardQuery()
const { colorFor } = useDeviceColors()

const { data: devices, pending: devicesPending } = useDevices()
const { data: summaries } = useSummary(rangeQuery)
const { data: costSeries } = useTimeseries(rangeQuery, 'cost', bucket)
const { data: tokenSeries } = useTimeseries(rangeQuery, 'tokens', bucket)
const { data: costByModel } = useBreakdown(rangeQuery, 'model')
const { data: toolVolume } = useBreakdown(rangeQuery, 'toolName')
const { data: tokenSplit } = useBreakdown(rangeQuery, 'tokenType')
const { data: apiErrors } = useBreakdown(rangeQuery, 'errorStatus')

const BREAKDOWN_LIMIT = 8

const isEmpty = computed(() => (devices.value ?? []).length === 0 && (summaries.value ?? []).length === 0)

function toSeries(points: SeriesPoint[] | null): ChartSeries[] {
  const grouped = new Map<string, SeriesPoint[]>()
  for (const point of points ?? []) {
    const bucketed = grouped.get(point.device)
    if (bucketed) {
      bucketed.push(point)
    } else {
      grouped.set(point.device, [point])
    }
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([device, devicePoints]) => ({
      key: device,
      label: device,
      color: colorFor(device),
      points: devicePoints
        .map(point => ({ x: Date.parse(point.bucket), y: point.value }))
        .sort((a, b) => a.x - b.x)
    }))
}

function toGroups(rows: BreakdownRow[] | null): ChartBarGroup[] {
  const grouped = new Map<string, BreakdownRow[]>()
  for (const row of rows ?? []) {
    const existing = grouped.get(row.key)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(row.key, [row])
    }
  }

  return [...grouped.entries()]
    .map(([key, keyRows]) => ({
      label: key,
      total: keyRows.reduce((sum, row) => sum + row.value, 0),
      bars: [...keyRows]
        .sort((a, b) => a.device.localeCompare(b.device))
        .map(row => ({ key: `${key}:${row.device}`, label: row.device, value: row.value, color: colorFor(row.device) }))
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, BREAKDOWN_LIMIT)
    .map(({ label, bars }) => ({ label, bars }))
}

function sum(rows: DeviceSummary[], of: (s: DeviceSummary) => number): number {
  return rows.reduce((total, row) => total + of(row), 0)
}

const costChart = computed(() => toSeries(costSeries.value))
const tokenChart = computed(() => toSeries(tokenSeries.value))
const modelBars = computed(() => toGroups(costByModel.value))
const toolBars = computed(() => toGroups(toolVolume.value))
const tokenBars = computed(() => toGroups(tokenSplit.value))
const errorBars = computed(() => toGroups(apiErrors.value))

interface Tile {
  label: string
  value: string
  hint?: string
}

const totals = computed<Tile[]>(() => {
  const rows = summaries.value ?? []
  const requests = sum(rows, s => s.apiRequests)
  const errors = sum(rows, s => s.apiErrors)

  return [
    { label: 'Total cost', value: formatUsd(sum(rows, s => s.costUsd)) },
    { label: 'Sessions', value: formatCount(sum(rows, s => s.sessions)) },
    { label: 'Active time', value: formatDuration(sum(rows, s => s.activeSeconds)) },
    { label: 'Lines added', value: formatCompact(sum(rows, s => s.linesAdded)) },
    { label: 'Tool calls', value: formatCount(sum(rows, s => s.toolCalls)) },
    {
      label: 'API error rate',
      value: requests > 0 ? `${((errors / requests) * 100).toFixed(1)}%` : '--',
      hint: `${formatCount(errors)} of ${formatCount(requests)} requests`
    }
  ]
})
</script>

<template>
  <UContainer class="py-8">
    <DashboardEmptyState
      v-if="isEmpty"
      :pending="devicesPending"
    />

    <div
      v-else
      class="space-y-6"
    >
      <DashboardFilters />

      <DashboardDeviceStrip :summaries="summaries ?? []" />

      <div class="grid gap-4 grid-cols-2 lg:grid-cols-6">
        <ChartStatTile
          v-for="tile in totals"
          :key="tile.label"
          :label="tile.label"
          :value="tile.value"
          :hint="tile.hint"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Cost over time
            </h2>
          </template>
          <ChartTimeSeries
            :series="costChart"
            :bucket="bucket"
            :format="formatUsd"
            area
          />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Tokens over time
            </h2>
          </template>
          <ChartTimeSeries
            :series="tokenChart"
            :bucket="bucket"
            :format="formatCompact"
          />
        </UCard>
      </div>

      <div class="grid gap-4 lg:grid-cols-2 items-start">
        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Cost by model
            </h2>
          </template>
          <ChartBars
            :groups="modelBars"
            :format="formatUsd"
          />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Tool calls by tool
            </h2>
          </template>
          <ChartBars
            :groups="toolBars"
            :format="formatCount"
          />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Tokens by type
            </h2>
          </template>
          <ChartBars
            :groups="tokenBars"
            :format="formatCompact"
          />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              API errors by status code
            </h2>
          </template>
          <ChartBars
            :groups="errorBars"
            :format="formatCount"
          />
        </UCard>
      </div>

      <UCard>
        <template #header>
          <h2 class="font-semibold">
            All measures by device
          </h2>
        </template>
        <DashboardSummaryTable :summaries="summaries ?? []" />
      </UCard>
    </div>
  </UContainer>
</template>

<script setup lang="ts">
import type { BreakdownRow, SeriesPoint } from '#shared/types'
import type { ChartBarGroup, ChartSeries } from '~/utils/viz'

const { rangeQuery, bucket, preset } = useDashboardQuery()
const { colorFor } = useDeviceColors()

const { data: devices, pending: devicesPending, unavailable } = useDevices()
const { data: summaries } = useSummary(rangeQuery)
const { data: costSeries } = useTimeseries(rangeQuery, 'cost', bucket)
const { data: tokenSeries } = useTimeseries(rangeQuery, 'tokens', bucket)
const { data: costByModel } = useBreakdown(rangeQuery, 'model')
const { data: toolVolume } = useBreakdown(rangeQuery, 'toolName')
const { data: tokenSplit } = useBreakdown(rangeQuery, 'tokenType')
const { data: apiErrors } = useBreakdown(rangeQuery, 'errorStatus')

const BREAKDOWN_LIMIT = 8
const LIVE_TOKEN_KEYS = ['input', 'output']
const CACHE_TOKEN_KEYS = ['cacheRead', 'cacheCreation']

// A missing devices API leaves the roster empty without meaning there are no
// machines, so it renders the dashboard degraded rather than the empty state.
const isEmpty = computed(() => !unavailable.value && (devices.value ?? []).length === 0)

function toSeries(points: SeriesPoint[] | null): ChartSeries[] {
  const grouped = new Map<string, SeriesPoint[]>()
  for (const point of points ?? []) {
    const bucketed = grouped.get(point.deviceId)
    if (bucketed) {
      bucketed.push(point)
    } else {
      grouped.set(point.deviceId, [point])
    }
  }

  return [...grouped.entries()]
    .map(([deviceId, devicePoints]) => ({
      key: deviceId,
      label: devicePoints[0]!.device,
      color: colorFor(deviceId),
      points: devicePoints
        .map(point => ({ x: Date.parse(point.bucket), y: point.value }))
        .sort((a, b) => a.x - b.x)
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function toGroups(rows: BreakdownRow[] | null, keep?: string[]): ChartBarGroup[] {
  const grouped = new Map<string, BreakdownRow[]>()
  for (const row of rows ?? []) {
    if (keep && !keep.includes(row.key)) continue
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
        .map(row => ({ key: `${key}:${row.deviceId}`, label: row.device, value: row.value, color: colorFor(row.deviceId) }))
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, BREAKDOWN_LIMIT)
    .map(({ label, bars }) => ({ label, bars }))
}

const costChart = computed(() => toSeries(costSeries.value))
const tokenChart = computed(() => toSeries(tokenSeries.value))
const modelBars = computed(() => toGroups(costByModel.value))
const toolBars = computed(() => toGroups(toolVolume.value))
const liveTokenBars = computed(() => toGroups(tokenSplit.value, LIVE_TOKEN_KEYS))
const cacheTokenBars = computed(() => toGroups(tokenSplit.value, CACHE_TOKEN_KEYS))
const errorBars = computed(() => toGroups(apiErrors.value))
</script>

<template>
  <div>
    <DashboardEmptyState
      v-if="isEmpty"
      :pending="devicesPending"
    />

    <template v-else>
      <DashboardNotices class="notices" />

      <DashboardFilters />

      <section class="hero">
        <h1 class="sr-only">
          Machine comparison, {{ preset.label.toLowerCase() }}
        </h1>
        <DashboardComparison :summaries="summaries ?? []" />
      </section>

      <div class="panels">
        <DashboardPanel eyebrow="Cost over time">
          <ChartTimeSeries
            :series="costChart"
            :bucket="bucket"
            :format="formatUsd"
          />
        </DashboardPanel>

        <DashboardPanel eyebrow="Tokens over time">
          <ChartTimeSeries
            :series="tokenChart"
            :bucket="bucket"
            :format="formatCompact"
          />
        </DashboardPanel>

        <DashboardPanel eyebrow="Cost by model">
          <ChartBars
            :groups="modelBars"
            :format="formatUsd"
          />
        </DashboardPanel>

        <DashboardPanel eyebrow="Tool calls by tool">
          <ChartBars
            :groups="toolBars"
            :format="formatCount"
          />
        </DashboardPanel>

        <DashboardPanel
          eyebrow="Live tokens"
          note="What you sent and what came back. Priced per token."
        >
          <ChartBars
            :groups="liveTokenBars"
            :format="formatCompact"
          />
        </DashboardPanel>

        <DashboardPanel
          eyebrow="Cache tokens"
          note="Context re-read and re-written between turns. Runs orders of magnitude larger, so it gets its own scale."
        >
          <ChartBars
            :groups="cacheTokenBars"
            :format="formatCompact"
          />
        </DashboardPanel>

        <DashboardPanel eyebrow="API errors by status code">
          <ChartBars
            :groups="errorBars"
            :format="formatCount"
          />
        </DashboardPanel>
      </div>

      <DashboardPanel
        eyebrow="Every measure, every machine"
        class="ledger"
      >
        <DashboardSummaryTable :summaries="summaries ?? []" />
      </DashboardPanel>
    </template>
  </div>
</template>

<style scoped>
.notices {
  margin-bottom: 24px;
}

.hero {
  padding: 36px 0 48px;
}

.panels {
  display: grid;
  gap: 40px 44px;
  grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr));
  padding-top: 40px;
  border-top: 1px solid var(--viz-baseline);
}

.ledger {
  margin-top: 48px;
}
</style>

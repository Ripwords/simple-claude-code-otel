<script setup lang="ts">
import type { SeriesPoint } from '#shared/types'
import type { ChartSeries } from '~/utils/viz'

const { rangeQuery, bucket, preset } = useDashboardQuery()
const { colorFor } = useDeviceColors()

const { data: devices, pending: devicesPending, unavailable } = useDevices()
const { data: summaries } = useSummary(rangeQuery)
const { data: costSeries } = useTimeseries(rangeQuery, 'cost', bucket)
const { data: tokenSeries } = useTimeseries(rangeQuery, 'tokens', bucket)
const { data: costByModel } = useBreakdown(rangeQuery, 'model')
const { data: tokensByModel } = useBreakdown(rangeQuery, 'modelTokens')
const { data: toolVolume } = useBreakdown(rangeQuery, 'toolName')
const { data: tokenSplit } = useBreakdown(rangeQuery, 'tokenType')
const { data: apiErrors } = useBreakdown(rangeQuery, 'errorStatus')

// Five named machines and one "others" band: past that, colour stops telling machines apart.
const STACKED_MACHINES = 5

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

  return [...grouped.entries()].map(([deviceId, devicePoints]) => ({
    key: deviceId,
    label: devicePoints[0]!.device,
    color: colorFor(deviceId),
    points: devicePoints
      .map(point => ({ x: Date.parse(point.bucket), y: point.value }))
      .sort((a, b) => a.x - b.x)
  }))
}

type TrendMetric = 'cost' | 'tokens'
const trend = ref<TrendMetric>('cost')
const TRENDS: Array<{ id: TrendMetric, label: string }> = [
  { id: 'cost', label: 'Spend' },
  { id: 'tokens', label: 'Tokens' }
]

const trendSeries = computed(() => topSeries(toSeries(trend.value === 'cost' ? costSeries.value : tokenSeries.value), STACKED_MACHINES))
const trendFormat = computed(() => trend.value === 'cost' ? formatUsd : formatCompact)

// Claude Code sends the literal string "undefined" when a request failed before any HTTP
// response (timeouts, dropped connections); "unknown" is the server's key for a missing status.
const ERROR_STATUSES: Record<string, string> = {
  undefined: 'No response',
  unknown: 'Not recorded'
}

const TOKEN_TYPES: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  cacheRead: 'Cache reads',
  cacheCreation: 'Cache writes'
}

const tools = computed(() => fleetTotals(toolVolume.value ?? []))
const errors = computed(() => fleetTotals(apiErrors.value ?? []))
const tokenMix = computed(() => fleetTotals(tokenSplit.value ?? []))

const machinesNote = computed(() => {
  const count = (summaries.value ?? []).length
  if (count === 2) return 'Two machines in view, so they are set side by side. The bar in the middle leans toward whichever did more.'
  return 'Sorted by spend. Every column sorts. The bar is each machine’s spend against the biggest spender.'
})
</script>

<template>
  <div>
    <DashboardEmptyState
      v-if="isEmpty"
      :pending="devicesPending"
    />

    <div
      v-else
      class="page"
    >
      <h1 class="sr-only">
        Claude Code usage, {{ preset.label.toLowerCase() }}
      </h1>

      <DashboardFilters>
        <DashboardNotices />
      </DashboardFilters>

      <DashboardStats
        :summaries="summaries ?? []"
        :cost-points="costSeries ?? []"
        :bucket="bucket"
        :range-label="preset.label"
        class="stats"
      />

      <DashboardPanel
        title="Machines"
        :note="machinesNote"
      >
        <DashboardComparison
          :summaries="summaries ?? []"
          :cost-by-model="costByModel ?? []"
        />
      </DashboardPanel>

      <DashboardPanel
        :title="trend === 'cost' ? 'Spend over time' : 'Tokens over time'"
        :note="trend === 'cost'
          ? `Stacked by machine, so the top edge is the fleet total per ${bucket}.`
          : `Every token type, cache included, stacked by machine per ${bucket}.`"
      >
        <template #actions>
          <div
            class="viz-segmented"
            role="group"
            aria-label="Measure over time"
          >
            <button
              v-for="option in TRENDS"
              :key="option.id"
              type="button"
              class="viz-segment"
              :aria-pressed="trend === option.id"
              @click="trend = option.id"
            >
              {{ option.label }}
            </button>
          </div>
        </template>

        <ChartTimeSeries
          :series="trendSeries"
          :bucket="bucket"
          :format="trendFormat"
          :height="260"
          stacked
        />
      </DashboardPanel>

      <DashboardPanel
        title="Models"
        note="Which models each machine leans on. The share is of that machine's own total."
      >
        <DashboardTopModels
          :cost-rows="costByModel ?? []"
          :token-rows="tokensByModel ?? []"
        />
      </DashboardPanel>

      <section
        class="work"
        aria-labelledby="work-heading"
      >
        <h2
          id="work-heading"
          class="viz-heading"
        >
          Where the work went
        </h2>
        <p class="viz-note work-note">
          Whole fleet. Select a row to see which machines it came from.
        </p>

        <div class="work-grid">
          <div>
            <h3 class="sub">
              Tool calls
            </h3>
            <ChartBars
              :items="tools"
              :format="formatCount"
              :limit="6"
            />
          </div>
          <div>
            <h3 class="sub">
              Tokens by type
            </h3>
            <ChartBars
              :items="tokenMix"
              :format="formatCompact"
              :label-of="key => TOKEN_TYPES[key] ?? key"
              color="var(--viz-ink-secondary)"
            />
          </div>
          <div>
            <h3 class="sub">
              API errors by status
            </h3>
            <ChartBars
              :items="errors"
              :format="formatCount"
              :limit="5"
              :label-of="key => ERROR_STATUSES[key] ?? key"
              color="var(--viz-status-serious)"
            />
          </div>
        </div>
      </section>

      <details class="ledger">
        <summary class="ledger-summary viz-focus">
          <span class="viz-heading">Every measure, every machine</span>
          <span class="viz-note">Latency percentiles, failures and the rest</span>
        </summary>
        <DashboardSummaryTable
          :summaries="summaries ?? []"
          class="ledger-table"
        />
      </details>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  /* minmax(0, 1fr), not the implicit auto track: an auto track grows to the widest child,
     so opening the 13-column ledger widened the whole page and slid it sideways. */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-xl);
  padding-top: var(--space-xs);
}

/* The toolbar and the hero belong together; everything after them is a new section. */
.stats {
  margin-top: calc(var(--space-xl) * -1 + var(--space-md));
}

.page > :deep(.panel),
.work,
.ledger {
  padding-top: var(--space-lg);
  border-top: var(--rule);
}

.work-note {
  margin: var(--space-3xs) 0 var(--space-md);
}

.work-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-xl);
}

.sub {
  margin-bottom: var(--space-xs);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--viz-ink-secondary);
}

.ledger-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3xs) var(--space-sm);
  cursor: pointer;
  list-style: none;
}

.ledger-summary::-webkit-details-marker {
  display: none;
}

.ledger-summary::before {
  content: "+";
  width: 1ch;
  font-family: var(--font-figure);
  color: var(--viz-muted);
}

.ledger[open] .ledger-summary::before {
  content: "\2212";
}

.ledger-table {
  margin-top: var(--space-md);
}

@media (width < 900px) {
  .work-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-lg);
  }
}

@media (width < 560px) {
  .page {
    gap: var(--space-xl);
  }

  .stats {
    margin-top: calc(var(--space-xl) * -1 + var(--space-md));
  }
}
</style>

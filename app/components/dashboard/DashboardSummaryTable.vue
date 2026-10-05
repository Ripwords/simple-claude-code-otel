<script setup lang="ts">
import type { DeviceSummary } from '#shared/types'

interface Props {
  summaries: DeviceSummary[]
}

const props = defineProps<Props>()

const { colorFor } = useDeviceColors()

interface Column {
  key: string
  label: string
  of: (s: DeviceSummary) => string
}

// Raw percentiles arrive as fractional milliseconds (8035.779). Under a second reads as whole
// ms, above it as seconds with one decimal, so the column scans without counting digits.
function formatMs(value: number | null): string {
  if (value === null) return EM_DASH
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(1)} s`
}

const COLUMNS: Column[] = [
  { key: 'cost', label: 'Cost', of: s => formatUsd(s.costUsd) },
  { key: 'sessions', label: 'Sessions', of: s => formatCount(s.sessions) },
  { key: 'active', label: 'Active time', of: s => formatDuration(s.activeSeconds) },
  { key: 'added', label: 'Lines +', of: s => formatCount(s.linesAdded) },
  { key: 'removed', label: 'Lines -', of: s => formatCount(s.linesRemoved) },
  { key: 'toolCalls', label: 'Tool calls', of: s => formatCount(s.toolCalls) },
  { key: 'toolFailures', label: 'Tool failures', of: s => formatCount(s.toolFailures) },
  { key: 'apiRequests', label: 'API requests', of: s => formatCount(s.apiRequests) },
  { key: 'apiErrors', label: 'API errors', of: s => formatCount(s.apiErrors) },
  { key: 'p50Tool', label: 'p50 tool', of: s => formatMs(s.p50ToolMs) },
  { key: 'p95Tool', label: 'p95 tool', of: s => formatMs(s.p95ToolMs) },
  { key: 'p50Api', label: 'p50 API', of: s => formatMs(s.p50ApiMs) },
  { key: 'p95Api', label: 'p95 API', of: s => formatMs(s.p95ApiMs) }
]

const rows = computed(() => [...props.summaries].sort((a, b) => a.device.localeCompare(b.device)).map(summary => ({
  deviceId: summary.deviceId,
  device: summary.device,
  color: colorFor(summary.deviceId),
  cells: COLUMNS.map(column => ({ key: column.key, value: column.of(summary) }))
})))
</script>

<template>
  <div class="scroller">
    <table class="table">
      <caption class="sr-only">
        Per-machine telemetry totals for the selected range
      </caption>
      <thead>
        <tr>
          <th
            scope="col"
            class="head device-head"
          >
            Machine
          </th>
          <th
            v-for="column in COLUMNS"
            :key="column.key"
            scope="col"
            class="head"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.deviceId"
        >
          <th
            scope="row"
            class="cell device-cell viz-mono"
          >
            <span
              class="dot"
              :style="{ backgroundColor: row.color }"
            />
            {{ row.device }}
          </th>
          <td
            v-for="cell in row.cells"
            :key="cell.key"
            class="cell amount viz-mono"
          >
            {{ cell.value }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* The page must never scroll sideways, so the width lives inside this box. */
.scroller {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.table {
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.head {
  padding: 0 var(--space-sm) var(--space-xs) 0;
  text-align: right;
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
  color: var(--viz-ink-secondary);
  border-bottom: var(--rule-strong);
}

.device-head {
  position: sticky;
  left: 0;
  z-index: 1;
  text-align: left;
  padding-right: var(--space-lg);
  background: var(--viz-surface);
}

.cell {
  padding: var(--space-xs) var(--space-sm) var(--space-xs) 0;
  white-space: nowrap;
  color: var(--viz-ink);
  border-bottom: var(--rule);
}

.device-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  text-align: left;
  font-weight: 500;
  padding-right: var(--space-lg);
  background: var(--viz-surface);
}

.amount {
  text-align: right;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: var(--space-2xs);
  border-radius: 50%;
}

tbody tr:last-child .cell {
  border-bottom: 0;
}
</style>

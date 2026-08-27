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

function formatMs(value: number | null): string {
  return value === null ? '--' : formatCount(value)
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
  { key: 'p50Tool', label: 'p50 tool ms', of: s => formatMs(s.p50ToolMs) },
  { key: 'p95Tool', label: 'p95 tool ms', of: s => formatMs(s.p95ToolMs) },
  { key: 'p50Api', label: 'p50 API ms', of: s => formatMs(s.p50ApiMs) },
  { key: 'p95Api', label: 'p95 API ms', of: s => formatMs(s.p95ApiMs) }
]

const rows = computed(() => [...props.summaries].sort((a, b) => a.device.localeCompare(b.device)).map(summary => ({
  device: summary.device,
  color: colorFor(summary.device),
  cells: COLUMNS.map(column => ({ key: column.key, value: column.of(summary) }))
})))
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm border-collapse">
      <caption class="sr-only">
        Per-device telemetry totals for the selected range
      </caption>
      <thead>
        <tr class="border-b border-default">
          <th
            scope="col"
            class="py-2 pe-4 text-left font-medium"
            :style="{ color: 'var(--viz-ink-secondary)' }"
          >
            Device
          </th>
          <th
            v-for="column in COLUMNS"
            :key="column.key"
            scope="col"
            class="py-2 px-3 text-right font-medium whitespace-nowrap"
            :style="{ color: 'var(--viz-ink-secondary)' }"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.device"
          class="border-b border-default last:border-0"
        >
          <th
            scope="row"
            class="py-2 pe-4 text-left font-normal whitespace-nowrap"
            :style="{ color: 'var(--viz-ink)' }"
          >
            <span class="flex items-center gap-2">
              <span
                class="size-2.5 rounded-full shrink-0"
                :style="{ backgroundColor: row.color }"
              />
              {{ row.device }}
            </span>
          </th>
          <td
            v-for="cell in row.cells"
            :key="cell.key"
            class="viz-tabular py-2 px-3 text-right whitespace-nowrap"
            :style="{ color: 'var(--viz-ink)' }"
          >
            {{ cell.value }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

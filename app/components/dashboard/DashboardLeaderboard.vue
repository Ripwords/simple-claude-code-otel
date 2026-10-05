<script setup lang="ts">
import type { BreakdownRow, DeviceSummary } from '#shared/types'

interface Props {
  summaries: DeviceSummary[]
  costByModel: BreakdownRow[]
}

const props = defineProps<Props>()

const { colorFor } = useDeviceColors()

type SortKey = 'device' | 'cost' | 'sessions' | 'active' | 'perHour' | 'errorRate'

interface Column {
  key: SortKey
  label: string
  numeric: boolean
}

const COLUMNS: Column[] = [
  { key: 'cost', label: 'Spend', numeric: true },
  { key: 'sessions', label: 'Sessions', numeric: true },
  { key: 'active', label: 'Active', numeric: true },
  { key: 'perHour', label: 'Per active hour', numeric: true },
  { key: 'errorRate', label: 'API errors', numeric: true }
]

const sortKey = ref<SortKey>('cost')
const descending = ref(true)

function sortBy(key: SortKey) {
  if (sortKey.value === key) {
    descending.value = !descending.value
  } else {
    sortKey.value = key
    // Names read A to Z; every measure reads largest first.
    descending.value = key !== 'device'
  }
}

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key) return 'none'
  return descending.value ? 'descending' : 'ascending'
}

const topModel = computed(() => new Map(rankTopModels(props.costByModel, 1)
  .map(machine => [machine.deviceId, machine.models[0] ?? null])))

const total = computed(() => props.summaries.reduce((sum, s) => sum + s.costUsd, 0))
const leader = computed(() => Math.max(0, ...props.summaries.map(s => s.costUsd)))

const rows = computed(() => {
  const built = props.summaries.map((s) => {
    const perHour = s.activeSeconds > 0 ? s.costUsd / (s.activeSeconds / 3600) : null
    const errorRate = s.apiRequests > 0 ? (s.apiErrors / s.apiRequests) * 100 : null
    const model = topModel.value.get(s.deviceId) ?? null
    return {
      deviceId: s.deviceId,
      device: s.device,
      color: colorFor(s.deviceId),
      sort: { device: s.device, cost: s.costUsd, sessions: s.sessions, active: s.activeSeconds, perHour, errorRate } as Record<SortKey, string | number | null>,
      cost: formatUsd(s.costUsd),
      share: total.value > 0 ? s.costUsd / total.value : 0,
      // Bars are scaled to the leader, not the total, so the biggest spender fills the track.
      extent: leader.value > 0 ? (s.costUsd / leader.value) * 100 : 0,
      sessions: formatCount(s.sessions),
      active: formatDuration(s.activeSeconds),
      perHour: perHour === null ? EM_DASH : formatUsd(perHour),
      errorRate: errorRate === null ? EM_DASH : `${errorRate.toFixed(1)}%`,
      model: model ? { short: shortModelName(model.model), full: model.model, share: model.share } : null
    }
  })

  const direction = descending.value ? -1 : 1
  return built.sort((a, b) => {
    const x = a.sort[sortKey.value]
    const y = b.sort[sortKey.value]
    // Rows with no value sink to the bottom whichever way the column is sorted.
    if (x === null && y === null) return a.device.localeCompare(b.device)
    if (x === null) return 1
    if (y === null) return -1
    const order = typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y)
    return order * direction || a.device.localeCompare(b.device)
  })
})

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
</script>

<template>
  <div class="scroller">
    <table class="board">
      <caption class="sr-only">
        Every machine in view with its spend, activity and most used model. Column headers sort the table.
      </caption>
      <thead>
        <tr>
          <th
            scope="col"
            class="head head-device"
            :aria-sort="ariaSort('device')"
          >
            <button
              type="button"
              class="sort viz-focus"
              @click="sortBy('device')"
            >
              Machine
              <UIcon
                v-if="sortKey === 'device'"
                :name="descending ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'"
                class="sort-icon"
                aria-hidden="true"
              />
            </button>
          </th>
          <th
            v-for="column in COLUMNS"
            :key="column.key"
            scope="col"
            class="head"
            :class="{ 'head-spend': column.key === 'cost' }"
            :aria-sort="ariaSort(column.key)"
          >
            <button
              type="button"
              class="sort viz-focus"
              @click="sortBy(column.key)"
            >
              {{ column.label }}
              <UIcon
                v-if="sortKey === column.key"
                :name="descending ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'"
                class="sort-icon"
                aria-hidden="true"
              />
            </button>
          </th>
          <th
            scope="col"
            class="head head-model"
          >
            Top model
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
            class="cell cell-device viz-mono"
          >
            <span
              class="dot"
              :style="{ backgroundColor: row.color }"
            />
            <span class="device-name">{{ row.device }}</span>
          </th>
          <td class="cell cell-spend">
            <span class="spend">
              <span class="viz-figure amount">{{ row.cost }}</span>
              <span class="viz-figure share">{{ percent.format(row.share) }}</span>
            </span>
            <span
              class="track"
              aria-hidden="true"
            >
              <span
                class="fill"
                :style="{ width: `${row.extent}%`, backgroundColor: row.color }"
              />
            </span>
          </td>
          <td class="cell num viz-figure">
            {{ row.sessions }}
          </td>
          <td class="cell num viz-figure">
            {{ row.active }}
          </td>
          <td class="cell num viz-figure">
            {{ row.perHour }}
          </td>
          <td class="cell num viz-figure">
            {{ row.errorRate }}
          </td>
          <td class="cell cell-model">
            <template v-if="row.model">
              <span :title="row.model.full">{{ row.model.short }}</span>
              <span class="viz-figure share">{{ percent.format(row.model.share) }}</span>
            </template>
            <span
              v-else
              class="none"
            >{{ EM_DASH }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* The page never scrolls sideways; a narrow screen scrolls this box instead. */
.scroller {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.board {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.head {
  padding: 0 var(--space-sm) var(--space-2xs) 0;
  text-align: right;
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
  color: var(--viz-ink-secondary);
  border-bottom: var(--rule-strong);
}

.head-device,
.head-spend,
.head-model {
  text-align: left;
}

.head-spend {
  width: 30%;
}

.sort {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3xs);
  padding: var(--space-3xs) 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.sort:hover,
[aria-sort="ascending"] .sort,
[aria-sort="descending"] .sort {
  color: var(--viz-ink);
}

.sort-icon {
  width: 12px;
  height: 12px;
}

.head-device,
.cell-device {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--viz-surface);
}

.cell {
  padding: var(--space-xs) var(--space-sm) var(--space-xs) 0;
  white-space: nowrap;
  color: var(--viz-ink);
  border-bottom: var(--rule);
  vertical-align: middle;
}

.cell-device {
  max-width: 14rem;
  padding-right: var(--space-md);
  text-align: left;
  font-weight: 500;
}

.device-name {
  display: inline-block;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: var(--space-2xs);
  border-radius: 50%;
}

.spend {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2xs);
}

.amount {
  font-weight: 500;
}

.share {
  margin-left: var(--space-3xs);
  font-size: var(--text-xs);
  color: var(--viz-muted);
}

.track {
  display: block;
  height: 4px;
  margin-top: var(--space-3xs);
  border-radius: var(--radius-bar);
  background: var(--viz-grid);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-bar);
}

.num {
  text-align: right;
}

.cell-model {
  color: var(--viz-ink-secondary);
}

.none {
  color: var(--viz-muted);
}

tbody tr:last-child .cell {
  border-bottom: 0;
}

tbody tr:hover .cell {
  background: var(--viz-page);
}
</style>

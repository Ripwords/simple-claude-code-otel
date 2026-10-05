<script setup lang="ts">
import type { BreakdownRow } from '#shared/types'

interface Props {
  rows: BreakdownRow[]
  format: (value: number) => string
}

const props = defineProps<Props>()

const { colorFor } = useDeviceColors()

const RANKS = [1, 2, 3] as const

const machines = computed(() => rankTopModels(props.rows, RANKS.length).map(machine => ({
  ...machine,
  color: colorFor(machine.deviceId),
  cells: RANKS.map((rank, i) => ({ rank, model: machine.models[i] ?? null }))
})))

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
</script>

<template>
  <p
    v-if="machines.length === 0"
    class="empty"
  >
    Nothing reported in this range.
  </p>

  <div
    v-else
    class="scroller"
  >
    <table class="table">
      <caption class="sr-only">
        The three most used models on each machine for the selected range
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
            v-for="rank in RANKS"
            :key="rank"
            scope="col"
            class="head"
          >
            #{{ rank }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="machine in machines"
          :key="machine.deviceId"
        >
          <th
            scope="row"
            class="cell device-cell viz-mono"
          >
            <span
              class="dot"
              :style="{ backgroundColor: machine.color }"
            />
            {{ machine.device }}
          </th>
          <td
            v-for="cell in machine.cells"
            :key="cell.rank"
            class="cell"
          >
            <template v-if="cell.model">
              <span
                class="model"
                :title="cell.model.model"
              >{{ shortModelName(cell.model.model) }}</span>
              <span class="figure viz-mono">
                {{ format(cell.model.value) }}
                <span class="share">{{ percent.format(cell.model.share) }}</span>
              </span>
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
.scroller {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.head {
  padding: 0 14px 8px 0;
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--viz-ink-secondary);
  border-bottom: 1px solid var(--viz-baseline);
}

.device-head,
.device-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  padding-right: 20px;
  background: var(--viz-surface);
}

.cell {
  padding: 9px 14px 9px 0;
  white-space: nowrap;
  vertical-align: top;
  color: var(--viz-ink);
  border-bottom: 1px solid var(--viz-grid);
}

.device-cell {
  text-align: left;
  font-weight: 500;
}

.model {
  display: block;
  font-weight: 500;
}

.figure {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--viz-ink-secondary);
}

.share {
  margin-left: 4px;
  color: var(--viz-muted);
}

.none,
.empty {
  color: var(--viz-muted);
}

.empty {
  font-size: 13px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 7px;
}

tbody tr:last-child .cell {
  border-bottom: 0;
}
</style>

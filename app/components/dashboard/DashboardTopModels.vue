<script setup lang="ts">
import type { BreakdownRow } from '#shared/types'

interface Props {
  costRows: BreakdownRow[]
  tokenRows: BreakdownRow[]
}

const props = defineProps<Props>()

const { colorFor } = useDeviceColors()

type Basis = 'cost' | 'tokens'
const basis = ref<Basis>('cost')

const BASES: Array<{ id: Basis, label: string }> = [
  { id: 'cost', label: 'By spend' },
  { id: 'tokens', label: 'By live tokens' }
]

const rows = computed(() => basis.value === 'cost' ? props.costRows : props.tokenRows)
const format = computed(() => basis.value === 'cost' ? formatUsd : formatCompact)

// Models take a tonal ramp of ink rather than the series hues, because those hues already
// mean "machine" on this page. Tones are assigned by fleet rank, so a model keeps its tone
// in every machine's bar.
const TONES = ['var(--viz-ink)', 'var(--viz-ink-secondary)', 'var(--viz-muted)', 'var(--viz-baseline)']
const REST_TONE = 'var(--viz-grid)'

const fleet = computed(() => fleetTotals(rows.value.filter(row => row.key !== 'Other' && row.key !== 'unknown')))
const toneOf = computed(() => new Map(fleet.value.map((item, index) => [item.key, TONES[index] ?? REST_TONE])))

const legend = computed(() => [
  ...fleet.value.slice(0, TONES.length).map(item => ({ label: shortModelName(item.key), color: toneOf.value.get(item.key)! })),
  ...(fleet.value.length > TONES.length ? [{ label: 'everything else', color: REST_TONE }] : [])
])

const machines = computed(() => rankTopModels(rows.value).map((machine) => {
  const ranked = machine.models.reduce((sum, model) => sum + model.share, 0)
  return {
    ...machine,
    color: colorFor(machine.deviceId),
    segments: [
      ...machine.models.map(model => ({ key: model.model, share: model.share, color: toneOf.value.get(model.model) ?? REST_TONE })),
      ...(ranked < 0.999 ? [{ key: 'rest', share: 1 - ranked, color: REST_TONE }] : [])
    ]
  }
}).sort((a, b) => b.total - a.total))

// The machines table above already lists every machine, so this list opens on the busiest few.
const FIRST_MACHINES = 6
const showAll = ref(false)
const shown = computed(() => showAll.value ? machines.value : machines.value.slice(0, FIRST_MACHINES))

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
</script>

<template>
  <div class="models">
    <div class="controls">
      <div
        class="viz-segmented"
        role="group"
        aria-label="Rank models by"
      >
        <button
          v-for="option in BASES"
          :key="option.id"
          type="button"
          class="viz-segment"
          :aria-pressed="basis === option.id"
          @click="basis = option.id"
        >
          {{ option.label }}
        </button>
      </div>
      <ChartLegend :items="legend" />
    </div>

    <p
      v-if="machines.length === 0"
      class="viz-no-data"
    >
      Nothing reported in this range.
    </p>

    <div
      v-else
      class="layout"
    >
      <div>
        <h3 class="sub">
          Top three on each machine
        </h3>
        <ul class="machines">
          <li
            v-for="machine in shown"
            :key="machine.deviceId"
            class="machine"
          >
            <span class="name viz-mono">
              <span
                class="dot"
                :style="{ backgroundColor: machine.color }"
              />
              <span class="name-text">{{ machine.device }}</span>
            </span>
            <span
              class="stack"
              role="img"
              :aria-label="machine.models.map(model => `${shortModelName(model.model)} ${percent.format(model.share)}`).join(', ')"
            >
              <span
                v-for="segment in machine.segments"
                :key="segment.key"
                class="segment"
                :style="{ width: `${segment.share * 100}%`, backgroundColor: segment.color }"
              />
            </span>
            <span class="ranked">
              <span
                v-for="(model, index) in machine.models"
                :key="model.model"
                class="pick"
                :title="`${model.model}: ${format(model.value)}`"
              >
                <span class="rank viz-figure">{{ index + 1 }}</span>
                {{ shortModelName(model.model) }}
                <span class="viz-figure pct">{{ percent.format(model.share) }}</span>
              </span>
            </span>
          </li>
        </ul>
        <button
          v-if="machines.length > FIRST_MACHINES"
          type="button"
          class="more viz-focus"
          :aria-expanded="showAll"
          @click="showAll = !showAll"
        >
          {{ showAll ? 'Show fewer' : `Show all ${machines.length} machines` }}
        </button>
      </div>

      <div>
        <h3 class="sub">
          Whole fleet
        </h3>
        <ChartBars
          :items="fleet"
          :format="format"
          :label-of="shortModelName"
          :limit="5"
          color="var(--viz-ink-secondary)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs) var(--space-md);
  margin-bottom: var(--space-md);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: var(--space-xl);
}

.sub {
  margin-bottom: var(--space-xs);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--viz-ink-secondary);
}

.machines {
  display: grid;
}

.machine {
  display: grid;
  grid-template-columns: minmax(7rem, 11rem) minmax(0, 1fr);
  grid-template-areas:
    "name stack"
    ". ranked";
  align-items: center;
  gap: var(--space-3xs) var(--space-sm);
  padding: var(--space-2xs) 0;
  border-bottom: var(--rule);
}

.machine:last-child {
  border-bottom: 0;
}

.name {
  grid-area: name;
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: 500;
}

.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}

.stack {
  grid-area: stack;
  display: flex;
  height: 10px;
  gap: 1px;
  border-radius: var(--radius-bar);
  overflow: hidden;
  background: var(--viz-surface);
}

.segment {
  display: block;
  height: 100%;
  min-width: 2px;
}

.ranked {
  grid-area: ranked;
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-sm);
  font-size: var(--text-xs);
  color: var(--viz-ink-secondary);
}

.pick {
  white-space: nowrap;
}

.more {
  margin-top: var(--space-xs);
  padding: var(--space-3xs) 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--text-xs);
  color: var(--viz-ink-secondary);
  text-decoration: underline;
  text-decoration-color: var(--viz-baseline);
  text-underline-offset: 3px;
  cursor: pointer;
}

.more:hover {
  color: var(--viz-ink);
}

.rank {
  color: var(--viz-muted);
}

.pct {
  color: var(--viz-muted);
}

@media (width < 760px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-lg);
  }

  .machine {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "name"
      "stack"
      "ranked";
  }
}
</style>

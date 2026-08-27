<script setup lang="ts">
import type { DeviceSummary } from '#shared/types'

interface Props {
  summaries: DeviceSummary[]
}

const props = defineProps<Props>()

const { colorFor } = useDeviceColors()

interface RatioDef {
  label: string
  of: (s: DeviceSummary) => number | null
  display: (value: number | null) => string
}

const RATIOS: RatioDef[] = [
  {
    label: 'Cost per active hour',
    of: s => s.activeSeconds > 0 ? s.costUsd / (s.activeSeconds / 3600) : null,
    display: v => v === null || !Number.isFinite(v) ? '--' : formatUsd(v)
  },
  {
    label: 'Lines added per hour',
    of: s => s.activeSeconds > 0 ? s.linesAdded / (s.activeSeconds / 3600) : null,
    display: v => formatRatio(v, '')
  },
  {
    label: 'Tool calls per session',
    of: s => s.sessions > 0 ? s.toolCalls / s.sessions : null,
    display: v => formatRatio(v, '')
  }
]

function deltaLabel(mine: number | null, other: number | null): string | null {
  if (mine === null || other === null || other <= 0 || mine <= other) return null
  const times = mine / other
  if (!Number.isFinite(times) || times < 1.05) return null
  return `${times.toFixed(1)}x`
}

const cards = computed(() => {
  const rows = [...props.summaries].sort((a, b) => a.device.localeCompare(b.device))
  const pair = rows.length === 2

  return rows.map((summary, index) => ({
    device: summary.device,
    color: colorFor(summary.device),
    cost: formatUsd(summary.costUsd),
    sessions: formatCount(summary.sessions),
    activeTime: formatDuration(summary.activeSeconds),
    lines: `+${formatCount(summary.linesAdded)} / -${formatCount(summary.linesRemoved)}`,
    ratios: RATIOS.map((ratio) => {
      const mine = ratio.of(summary)
      const other = pair ? ratio.of(rows[1 - index]!) : null
      return {
        label: ratio.label,
        value: ratio.display(mine),
        delta: pair ? deltaLabel(mine, other) : null
      }
    })
  }))
})
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <UCard
      v-for="card in cards"
      :key="card.device"
      :style="{ borderLeft: `3px solid ${card.color}` }"
    >
      <h2
        class="flex items-center gap-2 text-base font-semibold"
        :style="{ color: 'var(--viz-ink)' }"
      >
        <span
          class="size-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: card.color }"
        />
        {{ card.device }}
      </h2>

      <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt :style="{ color: 'var(--viz-ink-secondary)' }">
            Cost
          </dt>
          <dd :style="{ color: 'var(--viz-ink)' }">
            {{ card.cost }}
          </dd>
        </div>
        <div>
          <dt :style="{ color: 'var(--viz-ink-secondary)' }">
            Sessions
          </dt>
          <dd :style="{ color: 'var(--viz-ink)' }">
            {{ card.sessions }}
          </dd>
        </div>
        <div>
          <dt :style="{ color: 'var(--viz-ink-secondary)' }">
            Active time
          </dt>
          <dd :style="{ color: 'var(--viz-ink)' }">
            {{ card.activeTime }}
          </dd>
        </div>
        <div>
          <dt :style="{ color: 'var(--viz-ink-secondary)' }">
            Lines changed
          </dt>
          <dd :style="{ color: 'var(--viz-ink)' }">
            {{ card.lines }}
          </dd>
        </div>
      </dl>

      <dl class="mt-4 space-y-2 border-t border-default pt-3 text-sm">
        <div
          v-for="ratio in card.ratios"
          :key="ratio.label"
          class="flex items-baseline justify-between gap-3"
        >
          <dt :style="{ color: 'var(--viz-ink-secondary)' }">
            {{ ratio.label }}
          </dt>
          <dd class="flex items-baseline gap-2">
            <span
              class="viz-tabular"
              :style="{ color: 'var(--viz-ink)' }"
            >{{ ratio.value }}</span>
            <span
              v-if="ratio.delta"
              class="viz-tabular text-xs"
              :style="{ color: 'var(--viz-ink-secondary)' }"
            >{{ ratio.delta }}</span>
          </dd>
        </div>
      </dl>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import type { ChartBarGroup } from '~/utils/viz'

interface Props {
  groups: ChartBarGroup[]
  format?: (value: number) => string
  barHeight?: number
}

const props = withDefaults(defineProps<Props>(), {
  format: formatCompact,
  barHeight: 14
})

const DEFAULT_WIDTH = 720
const LABEL_WIDTH = 128
const BAR_GAP = 2
const GROUP_GAP = 16
const PAD_TOP = 6
const TOOLTIP_WIDTH = 190

interface Row {
  key: string
  groupLabel: string
  label: string
  value: number
  color: string
  y: number
}

const plot = useTemplateRef<HTMLDivElement>('plot')
const width = ref(DEFAULT_WIDTH)
const hoverKey = ref<string | null>(null)

let observer: ResizeObserver | null = null

onMounted(() => {
  if (!import.meta.client || !plot.value) return
  observer = new ResizeObserver((entries) => {
    const measured = entries[0]?.contentRect.width ?? 0
    if (measured > 0) width.value = measured
  })
  observer.observe(plot.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

const maxValue = computed(() => Math.max(0, ...props.groups.flatMap(g => g.bars.map(b => b.value))))
const hasData = computed(() => props.groups.length > 0 && maxValue.value > 0)

const distinctBars = computed(() => {
  const byLabel = new Map<string, string>()
  for (const group of props.groups) {
    for (const bar of group.bars) if (!byLabel.has(bar.label)) byLabel.set(bar.label, bar.color)
  }
  return [...byLabel].map(([label, color]) => ({ label, color }))
})

const showLegend = computed(() => props.groups.some(g => g.bars.length >= 2))
const showValues = computed(() => distinctBars.value.length > 0 && distinctBars.value.length <= 4)
const padRight = computed(() => (showValues.value ? 72 : 14))

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  let y = PAD_TOP
  for (const group of props.groups) {
    for (const bar of group.bars) {
      out.push({ key: `${group.label}::${bar.key}`, groupLabel: group.label, label: bar.label, value: bar.value, color: bar.color, y })
      y += props.barHeight + BAR_GAP
    }
    y += GROUP_GAP - BAR_GAP
  }
  return out
})

const groupRows = computed(() => props.groups.map((group) => {
  const owned = rows.value.filter(r => r.groupLabel === group.label)
  const first = owned[0]
  const last = owned[owned.length - 1]
  const top = first ? first.y : PAD_TOP
  const bottom = last ? last.y + props.barHeight : top
  return { label: group.label, y: (top + bottom) / 2 }
}))

const height = computed(() => {
  const last = rows.value[rows.value.length - 1]
  return last ? last.y + props.barHeight + PAD_TOP : PAD_TOP * 2
})

const sx = computed(() => linearScale([0, niceCeil(maxValue.value)], [LABEL_WIDTH, Math.max(LABEL_WIDTH + 1, width.value - padRight.value)]))

function barWidth(value: number): number {
  return Math.max(0, sx.value(value) - LABEL_WIDTH)
}

const tooltip = computed(() => {
  const row = rows.value.find(r => r.key === hoverKey.value)
  if (!row) return null
  const anchor = sx.value(row.value)
  const flip = anchor + 12 + TOOLTIP_WIDTH > width.value
  return {
    heading: row.groupLabel,
    label: row.label,
    color: row.color,
    value: props.format(row.value),
    left: flip ? anchor - 12 - TOOLTIP_WIDTH : anchor + 12,
    top: Math.max(0, row.y - 8)
  }
})

const ariaLabel = computed(() => `Bar chart across ${props.groups.length} categories`)
</script>

<template>
  <div v-if="hasData">
    <ChartLegend
      v-if="showLegend"
      :items="distinctBars"
      class="bars-legend"
    />

    <div
      ref="plot"
      class="bars-plot"
    >
      <svg
        role="img"
        :aria-label="ariaLabel"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
      >
        <title>{{ ariaLabel }}</title>

        <text
          v-for="group in groupRows"
          :key="group.label"
          class="category"
          text-anchor="end"
          :x="LABEL_WIDTH - 12"
          :y="group.y + 4"
        >{{ group.label }}</text>

        <line
          aria-hidden="true"
          :x1="LABEL_WIDTH"
          :x2="LABEL_WIDTH"
          :y1="0"
          :y2="height"
          class="baseline"
        />

        <g
          v-for="row in rows"
          :key="row.key"
        >
          <rect
            :x="LABEL_WIDTH"
            :y="row.y"
            :width="barWidth(row.value)"
            :height="barHeight"
            rx="4"
            :fill="row.color"
            class="bar"
          />
          <text
            v-if="showValues"
            class="value viz-tabular"
            :x="LABEL_WIDTH + barWidth(row.value) + 8"
            :y="row.y + barHeight / 2 + 4"
          >{{ format(row.value) }}</text>
          <rect
            :x="LABEL_WIDTH"
            :y="row.y - 4"
            :width="Math.max(0, width - padRight - LABEL_WIDTH)"
            :height="barHeight + 8"
            class="hit"
            @pointerenter="hoverKey = row.key"
            @pointerleave="hoverKey = null"
          />
        </g>
      </svg>

      <div
        v-if="tooltip"
        class="tooltip"
        :style="{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }"
      >
        <div class="tooltip-heading">
          {{ tooltip.heading }}
        </div>
        <div class="tooltip-row">
          <span
            class="tooltip-swatch"
            :style="{ background: tooltip.color }"
          />
          <span class="tooltip-label">{{ tooltip.label }}</span>
          <span class="tooltip-value viz-tabular">{{ tooltip.value }}</span>
        </div>
      </div>
    </div>
  </div>

  <p
    v-else
    class="viz-no-data"
  >
    No data in this range.
  </p>
</template>

<style scoped>
.bars-plot {
  position: relative;
  width: 100%;
}

.bars-legend {
  margin-bottom: 10px;
}

.baseline {
  stroke: var(--viz-baseline);
  stroke-width: 1;
}

.category {
  font-size: 12px;
  fill: var(--viz-ink-secondary);
}

.bar {
  stroke: var(--viz-surface);
  stroke-width: 2;
}

.value {
  font-size: 11px;
  fill: var(--viz-ink-secondary);
}

.hit {
  fill: transparent;
}

.tooltip {
  position: absolute;
  width: 190px;
  padding: 8px 10px;
  border: 1px solid var(--viz-grid);
  border-radius: 6px;
  background: var(--viz-surface);
  color: var(--viz-ink);
  box-shadow: 0 2px 8px var(--viz-shadow);
  pointer-events: none;
  font-size: 12px;
}

.tooltip-heading {
  margin-bottom: 6px;
  color: var(--viz-ink-secondary);
  font-size: 11px;
}

.tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.6;
}

.tooltip-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: none;
}

.tooltip-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tooltip-value {
  margin-left: auto;
  text-align: right;
}
</style>

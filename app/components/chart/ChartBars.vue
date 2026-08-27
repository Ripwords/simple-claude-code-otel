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
const CATEGORY_FONT_PX = 12
const FALLBACK_ADVANCE = CATEGORY_FONT_PX * 0.6
const LABEL_PAD = 12
const MIN_GUTTER = 56
const MAX_GUTTER_FRACTION = 0.42
const MIN_LABEL_CHARS = 4
const BAR_GAP = 2
const GROUP_GAP = 16
const PAD_TOP = 6
const TOOLTIP_WIDTH = 190

/**
 * Category labels are set in a mono face, so one measured advance width scales
 * to every label exactly. That is what lets the gutter be reserved rather than
 * guessed, which is what stopped long model ids being sliced off at x=0.
 */
const advance = ref(FALLBACK_ADVANCE)

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

function measureAdvance() {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace'
  context.font = `${CATEGORY_FONT_PX}px ${family}`
  const measured = context.measureText('0'.repeat(20)).width / 20
  if (measured > 0) advance.value = measured
}

onMounted(() => {
  if (!import.meta.client || !plot.value) return

  measureAdvance()
  document.fonts?.ready.then(measureAdvance)

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

const longestLabel = computed(() => Math.max(0, ...props.groups.map(g => g.label.length)))

const gutter = computed(() => {
  const ceiling = Math.max(MIN_GUTTER, width.value * MAX_GUTTER_FRACTION)
  return Math.min(longestLabel.value * advance.value + LABEL_PAD, ceiling)
})

const labelChars = computed(() => Math.max(MIN_LABEL_CHARS, Math.floor((gutter.value - LABEL_PAD) / advance.value)))

function shorten(label: string): string {
  return label.length <= labelChars.value ? label : `${label.slice(0, labelChars.value - 1)}…`
}

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
  return { label: group.label, short: shorten(group.label), truncated: group.label.length > labelChars.value, y: (top + bottom) / 2 }
}))

const height = computed(() => {
  const last = rows.value[rows.value.length - 1]
  return last ? last.y + props.barHeight + PAD_TOP : PAD_TOP * 2
})

const sx = computed(() => linearScale([0, niceCeil(maxValue.value)], [gutter.value, Math.max(gutter.value + 1, width.value - padRight.value)]))

/**
 * Any non-zero value gets at least MIN_BAR of ink. Without it a real reading
 * next to a much larger one rounds to zero width and reads as "nothing here".
 */
const MIN_BAR = 3

function barWidth(value: number): number {
  if (value <= 0) return 0
  return Math.max(MIN_BAR, sx.value(value) - gutter.value)
}

const tooltip = computed(() => {
  const row = rows.value.find(r => r.key === hoverKey.value)
  if (!row) return null
  const anchor = gutter.value + barWidth(row.value)
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
          :x="gutter - LABEL_PAD"
          :y="group.y + 4"
        >
          <title v-if="group.truncated">{{ group.label }}</title>
          {{ group.short }}
        </text>

        <line
          aria-hidden="true"
          :x1="gutter"
          :x2="gutter"
          :y1="0"
          :y2="height"
          class="baseline"
        />

        <g
          v-for="row in rows"
          :key="row.key"
        >
          <rect
            :x="gutter"
            :y="row.y"
            :width="barWidth(row.value)"
            :height="barHeight"
            rx="3"
            :fill="row.color"
          />
          <text
            v-if="showValues"
            class="value viz-tabular"
            :x="gutter + barWidth(row.value) + 8"
            :y="row.y + barHeight / 2 + 4"
          >{{ format(row.value) }}</text>
          <rect
            :x="gutter"
            :y="row.y - 4"
            :width="Math.max(0, width - padRight - gutter)"
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
        <div class="tooltip-heading viz-mono">
          {{ tooltip.heading }}
        </div>
        <div class="tooltip-row">
          <span
            class="tooltip-swatch"
            :style="{ background: tooltip.color }"
          />
          <span class="tooltip-label viz-mono">{{ tooltip.label }}</span>
          <span class="tooltip-value viz-mono">{{ tooltip.value }}</span>
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
  overflow-wrap: anywhere;
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

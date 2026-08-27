<script setup lang="ts">
import type { ChartSeries } from '~/utils/viz'

interface Props {
  series: ChartSeries[]
  bucket: 'hour' | 'day'
  height?: number
  format?: (value: number) => string
  area?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: 240,
  format: formatCompact,
  area: false
})

const DEFAULT_WIDTH = 720
const PAD_TOP = 10
const PAD_BOTTOM = 24
const PAD_LEFT = 46
const LABEL_GUTTER = 96
const TOOLTIP_WIDTH = 190

const plot = useTemplateRef<HTMLDivElement>('plot')
const width = ref(DEFAULT_WIDTH)
const hoverIndex = ref<number | null>(null)

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

const drawn = computed(() => props.series.filter(s => s.points.length > 0))
const hasData = computed(() => drawn.value.length > 0)

const directLabels = computed(() => drawn.value.length > 0 && drawn.value.length <= 4)
const padRight = computed(() => (directLabels.value ? LABEL_GUTTER : 28))

const xValues = computed(() => {
  const seen = new Set<number>()
  for (const s of drawn.value) {
    for (const p of s.points) seen.add(p.x)
  }
  return [...seen].sort((a, b) => a - b)
})

const maxY = computed(() => {
  let max = 0
  for (const s of drawn.value) {
    for (const p of s.points) if (p.y > max) max = p.y
  }
  return max
})

const ticks = computed(() => niceTicks(maxY.value))

const sx = computed(() => {
  const xs = xValues.value
  const first = xs[0] ?? 0
  const last = xs[xs.length - 1] ?? 1
  return linearScale([first, last], [PAD_LEFT, Math.max(PAD_LEFT + 1, width.value - padRight.value)])
})

const sy = computed(() => linearScale([0, niceCeil(maxY.value)], [props.height - PAD_BOTTOM, PAD_TOP]))

const baselineY = computed(() => sy.value(0))

const TICK_MIN_SPACING = 74

const xTicks = computed(() => {
  const xs = xValues.value
  const room = Math.max(2, Math.floor((width.value - PAD_LEFT - padRight.value) / TICK_MIN_SPACING))
  const count = Math.min(6, room)
  if (xs.length <= count) return xs
  const step = (xs.length - 1) / (count - 1)
  const picked = new Set<number>()
  for (let i = 0; i < count; i++) picked.add(xs[Math.round(i * step)]!)
  return [...picked]
})

const lookups = computed(() => drawn.value.map(s => new Map(s.points.map(p => [p.x, p.y]))))

const paths = computed(() => drawn.value.map(s => linePath(s.points, sx.value, sy.value)))

const areaFill = computed(() => {
  const only = props.area && drawn.value.length === 1 ? drawn.value[0] : undefined
  return only ? areaPath(only.points, sx.value, sy.value, baselineY.value) : ''
})

const LABEL_MIN_GAP = 13

const endLabels = computed(() => {
  if (!directLabels.value) return []
  const placed = drawn.value
    .map((s) => {
      const last = s.points[s.points.length - 1]!
      return { key: s.key, label: s.label, color: s.color, x: sx.value(last.x) + 7, y: sy.value(last.y) + 4 }
    })
    .sort((a, b) => a.y - b.y)

  for (let i = 1; i < placed.length; i++) {
    const previous = placed[i - 1]!
    const current = placed[i]!
    if (current.y - previous.y < LABEL_MIN_GAP) current.y = previous.y + LABEL_MIN_GAP
  }
  return placed
})

const legendItems = computed(() => drawn.value.map(s => ({ label: s.label, color: s.color })))

const hoverX = computed(() => {
  const index = hoverIndex.value
  return index === null ? null : xValues.value[index] ?? null
})

const hoverMarkers = computed(() => {
  const x = hoverX.value
  if (x === null) return []
  return drawn.value.flatMap((s, i) => {
    const y = lookups.value[i]!.get(x)
    return y === undefined ? [] : [{ key: s.key, color: s.color, cx: sx.value(x), cy: sy.value(y) }]
  })
})

const tooltip = computed(() => {
  const x = hoverX.value
  if (x === null) return null
  const anchor = sx.value(x)
  const flip = anchor + 12 + TOOLTIP_WIDTH > width.value
  return {
    heading: formatBucket(new Date(x).toISOString(), props.bucket),
    rows: drawn.value.flatMap((s, i) => {
      const y = lookups.value[i]!.get(x)
      return y === undefined ? [] : [{ key: s.key, label: s.label, color: s.color, value: props.format(y) }]
    }),
    left: flip ? anchor - 12 - TOOLTIP_WIDTH : anchor + 12
  }
})

const ariaLabel = computed(() => {
  const names = drawn.value.map(s => s.label).join(', ')
  return `Time series by ${props.bucket}${names ? `: ${names}` : ''}`
})

function onMove(event: PointerEvent) {
  const xs = xValues.value
  const bounds = (event.currentTarget as SVGRectElement).ownerSVGElement?.getBoundingClientRect()
  if (xs.length === 0 || !bounds) return
  const local = event.clientX - bounds.left
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < xs.length; i++) {
    const distance = Math.abs(sx.value(xs[i]!) - local)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  hoverIndex.value = best
}
</script>

<template>
  <div v-if="hasData">
    <ChartLegend
      v-if="drawn.length >= 2"
      :items="legendItems"
      class="ts-legend"
    />

    <div
      ref="plot"
      class="ts-plot"
    >
      <svg
        role="img"
        :aria-label="ariaLabel"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
      >
        <title>{{ ariaLabel }}</title>

        <g aria-hidden="true">
          <line
            v-for="tick in ticks"
            :key="`grid-${tick}`"
            :x1="PAD_LEFT"
            :x2="width - padRight"
            :y1="sy(tick)"
            :y2="sy(tick)"
            class="grid"
          />
        </g>

        <line
          :x1="PAD_LEFT"
          :x2="width - padRight"
          :y1="baselineY"
          :y2="baselineY"
          class="baseline"
        />

        <text
          v-for="tick in ticks"
          :key="`ytick-${tick}`"
          class="tick viz-tabular"
          text-anchor="end"
          :x="PAD_LEFT - 8"
          :y="sy(tick) + 4"
        >{{ format(tick) }}</text>

        <text
          v-for="tick in xTicks"
          :key="`xtick-${tick}`"
          class="tick viz-tabular"
          text-anchor="middle"
          :x="sx(tick)"
          :y="height - 8"
        >{{ formatAxisTick(tick, bucket) }}</text>

        <path
          v-if="areaFill"
          :d="areaFill"
          :fill="drawn[0]!.color"
          class="area"
        />

        <path
          v-for="(d, i) in paths"
          :key="drawn[i]!.key"
          :d="d"
          :stroke="drawn[i]!.color"
          class="line"
        />

        <template v-if="hoverX !== null">
          <line
            :x1="sx(hoverX)"
            :x2="sx(hoverX)"
            :y1="PAD_TOP"
            :y2="baselineY"
            class="crosshair"
          />
          <circle
            v-for="marker in hoverMarkers"
            :key="marker.key"
            :cx="marker.cx"
            :cy="marker.cy"
            r="4"
            :fill="marker.color"
            class="marker"
          />
        </template>

        <text
          v-for="label in endLabels"
          :key="label.key"
          class="end-label"
          :x="label.x"
          :y="label.y"
          :fill="label.color"
        >{{ label.label }}</text>

        <rect
          :x="PAD_LEFT"
          :y="PAD_TOP"
          :width="Math.max(0, width - padRight - PAD_LEFT)"
          :height="Math.max(0, baselineY - PAD_TOP)"
          class="hit"
          @pointermove="onMove"
          @pointerleave="hoverIndex = null"
        />
      </svg>

      <div
        v-if="tooltip"
        class="tooltip"
        :style="{ left: `${tooltip.left}px` }"
      >
        <div class="tooltip-heading">
          {{ tooltip.heading }}
        </div>
        <div
          v-for="row in tooltip.rows"
          :key="row.key"
          class="tooltip-row"
        >
          <span
            class="tooltip-swatch"
            :style="{ background: row.color }"
          />
          <span class="tooltip-label">{{ row.label }}</span>
          <span class="tooltip-value viz-tabular">{{ row.value }}</span>
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
.ts-plot {
  position: relative;
  width: 100%;
}

.ts-legend {
  margin-bottom: 8px;
}

.grid {
  stroke: var(--viz-grid);
  stroke-width: 1;
}

.baseline,
.crosshair {
  stroke: var(--viz-baseline);
  stroke-width: 1;
}

.crosshair {
  stroke-dasharray: 3 3;
}

.tick {
  font-size: 11px;
  fill: var(--viz-muted);
}

.line {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.area {
  opacity: 0.12;
  stroke: none;
}

.marker {
  stroke: var(--viz-surface);
  stroke-width: 2;
}

.end-label {
  font-size: 11px;
  paint-order: stroke;
  stroke: var(--viz-surface);
  stroke-width: 3;
  stroke-linejoin: round;
}

.hit {
  fill: transparent;
}

.tooltip {
  position: absolute;
  top: 8px;
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

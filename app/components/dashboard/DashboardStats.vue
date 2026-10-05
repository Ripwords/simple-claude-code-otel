<script setup lang="ts">
import type { Bucket, DeviceSummary, SeriesPoint } from '#shared/types'

interface Props {
  summaries: DeviceSummary[]
  costPoints: SeriesPoint[]
  bucket: Bucket
  rangeLabel: string
}

const props = defineProps<Props>()

const SPARK_HEIGHT = 88
const SPARK_PAD = 4

const sum = (of: (s: DeviceSummary) => number) => props.summaries.reduce((total, s) => total + of(s), 0)

const spend = computed(() => sum(s => s.costUsd))
const activeSeconds = computed(() => sum(s => s.activeSeconds))
const machines = computed(() => props.summaries.filter(s => s.costUsd > 0 || s.sessions > 0).length)

// Only figures this page actually has. There is no previous period to compare against, so
// there are no deltas; an invented "+12%" would be worse than none.
const figures = computed(() => {
  const requests = sum(s => s.apiRequests)
  return [
    { key: 'tokens', label: 'Live tokens', value: formatCompact(sum(s => s.inputTokens + s.outputTokens)), note: 'input + output' },
    { key: 'sessions', label: 'Sessions', value: formatCount(sum(s => s.sessions)) },
    { key: 'active', label: 'Active time', value: formatDuration(activeSeconds.value) },
    { key: 'lines', label: 'Lines added', value: formatCompact(sum(s => s.linesAdded)) },
    { key: 'errors', label: 'API error rate', value: requests > 0 ? `${((sum(s => s.apiErrors) / requests) * 100).toFixed(1)}%` : EM_DASH }
  ]
})

const perHour = computed(() => activeSeconds.value > 0 ? spend.value / (activeSeconds.value / 3600) : null)

// The fleet's spend per bucket, as one series.
const totals = computed(() => {
  const byBucket = new Map<number, number>()
  for (const point of props.costPoints) {
    const x = Date.parse(point.bucket)
    byBucket.set(x, (byBucket.get(x) ?? 0) + point.value)
  }
  return [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }))
})

const spark = useTemplateRef<HTMLDivElement>('spark')
const width = ref(320)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!spark.value) return
  observer = new ResizeObserver((entries) => {
    const measured = entries[0]?.contentRect.width ?? 0
    if (measured > 0) width.value = measured
  })
  observer.observe(spark.value)
})

onBeforeUnmount(() => observer?.disconnect())

const shape = computed(() => {
  const points = totals.value
  if (points.length < 2) return null
  const max = Math.max(...points.map(p => p.y))
  const sx = linearScale([points[0]!.x, points[points.length - 1]!.x], [SPARK_PAD, width.value - SPARK_PAD])
  const sy = linearScale([0, max || 1], [SPARK_HEIGHT - SPARK_PAD, SPARK_PAD])
  const line = linePath(points, sx, sy)
  const base = (SPARK_HEIGHT - SPARK_PAD).toFixed(2)
  const peak = points.reduce((best, p) => (p.y > best.y ? p : best), points[0]!)
  return {
    line,
    area: `${line} L${sx(points[points.length - 1]!.x).toFixed(2)},${base} L${sx(points[0]!.x).toFixed(2)},${base} Z`,
    peak: { cx: sx(peak.x), cy: sy(peak.y), label: `${formatUsd(peak.y)} · ${formatBucket(new Date(peak.x).toISOString(), props.bucket)}` }
  }
})

const sparkLabel = computed(() => shape.value
  ? `Spend per ${props.bucket}, ${props.rangeLabel.toLowerCase()}. Peak ${shape.value.peak.label}.`
  : 'Not enough data points for a trend.')
</script>

<template>
  <section
    class="stats"
    aria-labelledby="stats-spend"
  >
    <div class="lead">
      <p
        id="stats-spend"
        class="viz-note"
      >
        Spend, {{ rangeLabel.toLowerCase() }}
      </p>
      <p class="total viz-figure">
        {{ formatUsd(spend) }}
      </p>
      <p class="caption">
        across {{ machines }} {{ machines === 1 ? 'machine' : 'machines' }}<template v-if="perHour !== null">
          · <span class="viz-figure">{{ formatUsd(perHour) }}</span> per active hour
        </template>
      </p>
    </div>

    <div
      ref="spark"
      class="spark"
    >
      <svg
        v-if="shape"
        role="img"
        :aria-label="sparkLabel"
        :width="width"
        :height="SPARK_HEIGHT"
        :viewBox="`0 0 ${width} ${SPARK_HEIGHT}`"
      >
        <path
          :d="shape.area"
          class="spark-area"
        />
        <path
          :d="shape.line"
          class="spark-line"
        />
        <circle
          :cx="shape.peak.cx"
          :cy="shape.peak.cy"
          r="3"
          class="spark-peak"
        />
      </svg>
      <p
        v-if="shape"
        class="viz-note peak"
      >
        Peak <span class="viz-figure">{{ shape.peak.label }}</span>
      </p>
    </div>

    <dl class="figures">
      <div
        v-for="figure in figures"
        :key="figure.key"
        class="figure"
      >
        <dt class="viz-note">
          {{ figure.label }}
        </dt>
        <dd class="value viz-figure">
          {{ figure.value }}
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  grid-template-areas:
    "lead spark"
    "figures figures";
  gap: var(--space-lg) var(--space-xl);
  align-items: end;
}

.lead {
  grid-area: lead;
  min-width: 0;
}

.total {
  margin: var(--space-3xs) 0 var(--space-2xs);
  font-size: var(--text-display);
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--viz-ink);
  overflow-wrap: anywhere;
}

.caption {
  font-size: var(--text-sm);
  color: var(--viz-ink-secondary);
}

.spark {
  grid-area: spark;
  min-width: 0;
}

.spark svg {
  display: block;
  overflow: visible;
}

.spark-area {
  fill: var(--viz-series-1);
  opacity: 0.12;
}

.spark-line {
  fill: none;
  stroke: var(--viz-series-1);
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.spark-peak {
  fill: var(--viz-surface);
  stroke: var(--viz-series-1);
  stroke-width: 1.5;
}

.peak {
  margin-top: var(--space-2xs);
  text-align: right;
}

.figures {
  grid-area: figures;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-top: var(--rule);
}

.figure {
  min-width: 0;
  padding: var(--space-sm) var(--space-sm) 0 0;
}

.figure + .figure {
  padding-left: var(--space-sm);
  border-left: var(--rule);
}

.value {
  margin-top: var(--space-3xs);
  font-size: var(--text-figure);
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--viz-ink);
  white-space: nowrap;
}

@media (width < 760px) {
  .stats {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "lead"
      "spark"
      "figures";
    gap: var(--space-md);
  }

  .figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .figure,
  .figure + .figure {
    padding: var(--space-xs) 0;
    border-left: 0;
    border-bottom: var(--rule);
  }

  .figure:nth-child(even) {
    padding-left: var(--space-sm);
    border-left: var(--rule);
  }
}
</style>

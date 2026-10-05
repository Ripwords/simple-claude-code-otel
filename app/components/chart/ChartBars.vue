<script setup lang="ts">
import type { FleetTotal } from '~/utils/viz'

interface Props {
  items: FleetTotal[]
  format?: (value: number) => string
  /** Rows shown before the rest fold into one "Other" row. */
  limit?: number
  /** Display text for a key, e.g. a shortened model id. The full key stays in the title. */
  labelOf?: (key: string) => string
  /** Bar colour; one hue, because every bar here is the same measure. */
  color?: string
}

const props = withDefaults(defineProps<Props>(), {
  format: formatCompact,
  limit: 6,
  labelOf: (key: string) => key,
  color: 'var(--viz-series-1)'
})

const { colorFor } = useDeviceColors()

const MACHINES_SHOWN = 5

const rows = computed(() => {
  const kept = props.items.slice(0, props.limit)
  const rest = props.items.slice(props.limit)
  const all = rest.length > 1
    ? [...kept, { key: `${rest.length} others`, total: rest.reduce((sum, item) => sum + item.total, 0), parts: [] }]
    : props.items
  const top = Math.max(0, ...all.map(item => item.total))
  const sum = all.reduce((total, item) => total + item.total, 0)
  return all.map((item, index) => ({
    ...item,
    folded: rest.length > 1 && index === all.length - 1,
    label: rest.length > 1 && index === all.length - 1 ? item.key : props.labelOf(item.key),
    extent: top > 0 ? (item.total / top) * 100 : 0,
    share: sum > 0 ? item.total / sum : 0,
    machines: item.parts.slice(0, MACHINES_SHOWN).map(part => ({ ...part, color: colorFor(part.deviceId) })),
    moreMachines: Math.max(0, item.parts.length - MACHINES_SHOWN)
  }))
})

const open = ref<string | null>(null)

function toggle(key: string) {
  open.value = open.value === key ? null : key
}

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
</script>

<template>
  <ul
    v-if="rows.length > 0"
    class="bars"
  >
    <li
      v-for="row in rows"
      :key="row.key"
      class="row"
    >
      <component
        :is="row.folded || row.parts.length < 2 ? 'div' : 'button'"
        :type="row.folded || row.parts.length < 2 ? undefined : 'button'"
        class="line"
        :class="{ 'is-toggle': !row.folded && row.parts.length >= 2 }"
        :aria-expanded="row.folded || row.parts.length < 2 ? undefined : open === row.key"
        @click="!row.folded && row.parts.length >= 2 && toggle(row.key)"
      >
        <span
          class="label"
          :title="row.key"
        >{{ row.label }}</span>
        <span class="value viz-figure">{{ format(row.total) }}</span>
        <span class="share viz-figure">{{ percent.format(row.share) }}</span>
        <span
          class="track"
          aria-hidden="true"
        >
          <span
            class="fill"
            :style="{ width: `${Math.max(row.extent, row.total > 0 ? 1 : 0)}%`, backgroundColor: row.folded ? 'var(--viz-other)' : color }"
          />
        </span>
      </component>

      <ul
        v-if="open === row.key"
        class="split"
        :aria-label="`${row.label} by machine`"
      >
        <li
          v-for="part in row.machines"
          :key="part.deviceId"
          class="split-row"
        >
          <span
            class="dot"
            :style="{ backgroundColor: part.color }"
          />
          <span class="split-name viz-mono">{{ part.device }}</span>
          <span class="viz-figure">{{ format(part.value) }}</span>
        </li>
        <li
          v-if="row.moreMachines > 0"
          class="split-row split-more"
        >
          and {{ row.moreMachines }} more
        </li>
      </ul>
    </li>
  </ul>

  <p
    v-else
    class="viz-no-data"
  >
    Nothing in this range.
  </p>
</template>

<style scoped>
.bars {
  display: grid;
  gap: var(--space-2xs);
}

.line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 3.25rem;
  grid-template-areas:
    "label value share"
    "track track track";
  align-items: baseline;
  gap: var(--space-3xs) var(--space-2xs);
  width: 100%;
  padding: var(--space-3xs) 0;
  border: 0;
  background: transparent;
  color: var(--viz-ink);
  font: inherit;
  text-align: left;
}

.is-toggle {
  cursor: pointer;
}

.is-toggle:hover .label {
  text-decoration: underline;
  text-decoration-color: var(--viz-baseline);
  text-underline-offset: 3px;
}

.is-toggle:focus-visible {
  outline: 2px solid var(--viz-ink);
  outline-offset: 2px;
}

.label {
  grid-area: label;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}

.value {
  grid-area: value;
  font-size: var(--text-sm);
}

.share {
  grid-area: share;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--viz-muted);
}

.track {
  grid-area: track;
  display: block;
  height: 6px;
  border-radius: var(--radius-bar);
  background: var(--viz-grid);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-bar);
  transform-origin: left;
  animation: grow var(--dur-medium) var(--ease-out) both;
}

@keyframes grow {
  from {
    transform: scaleX(0);
  }
}

.split {
  display: grid;
  gap: var(--space-3xs);
  margin: var(--space-3xs) 0 var(--space-2xs);
  padding-left: var(--space-xs);
  border-left: var(--rule);
  font-size: var(--text-xs);
  color: var(--viz-ink-secondary);
}

.split-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2xs);
}

.split-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.split-more {
  display: block;
  color: var(--viz-muted);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

@media (prefers-reduced-motion: reduce) {
  .fill {
    animation: none;
  }
}
</style>

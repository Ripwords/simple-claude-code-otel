<script setup lang="ts">
import type { DeviceSummary } from '#shared/types'

const props = defineProps<{ summaries: DeviceSummary[] }>()

const { colorFor } = useDeviceColors()

const left = computed(() => props.summaries[0]!)
const right = computed(() => props.summaries[1]!)

const sides = computed(() => [left.value, right.value].map(summary => ({
  device: summary.device,
  color: colorFor(summary.deviceId)
})))

const groups = computed(() => MEASURE_GROUPS.map(group => ({
  ...group,
  rows: measuresIn(group.id).map((measure) => {
    const a = measure.of(left.value)
    const b = measure.of(right.value)
    const split = divergence(a, b)

    return {
      key: measure.key,
      label: measure.label,
      leftText: measure.display(a),
      rightText: measure.display(b),
      ratio: split?.ratio ?? EM_DASH,
      dominant: split?.dominant ?? null,
      extent: split ? Math.abs(split.share - 0.5) * 100 : 0,
      color: split?.dominant === 'left'
        ? colorFor(left.value.deviceId)
        : split?.dominant === 'right' ? colorFor(right.value.deviceId) : 'var(--viz-baseline)'
    }
  })
})))

const ordered = computed(() => groups.value.flatMap(group => group.rows.map(row => row.key)))

const grown = ref(false)
onMounted(() => nextTick(() => {
  grown.value = true
}))

function fillStyle(row: { dominant: 'left' | 'right' | null, extent: number, color: string, key: string }) {
  const extent = grown.value ? row.extent : 0
  const anchor = row.dominant === 'right' ? { left: '50%' } : { right: '50%' }
  return {
    ...anchor,
    width: `${extent}%`,
    background: row.color,
    transitionDelay: `${ordered.value.indexOf(row.key) * 40}ms`
  }
}
</script>

<template>
  <table class="spine">
    <caption class="sr-only">
      Every measure for {{ sides[0]!.device }} and {{ sides[1]!.device }}, with the gap between them
    </caption>

    <thead>
      <tr>
        <th
          scope="col"
          class="head head-left"
        >
          <span
            class="dot"
            :style="{ backgroundColor: sides[0]!.color }"
          />
          <span class="viz-mono">{{ sides[0]!.device }}</span>
        </th>
        <th
          scope="col"
          class="head head-gutter viz-eyebrow"
        >
          Gap
        </th>
        <th
          scope="col"
          class="head head-right"
        >
          <span class="viz-mono">{{ sides[1]!.device }}</span>
          <span
            class="dot"
            :style="{ backgroundColor: sides[1]!.color }"
          />
        </th>
      </tr>
    </thead>

    <tbody
      v-for="group in groups"
      :key="group.id"
    >
      <tr class="group">
        <th
          scope="colgroup"
          colspan="3"
          class="group-cell"
        >
          <span class="viz-eyebrow">{{ group.label }}</span>
          <span
            v-if="group.caption"
            class="group-caption"
          >{{ group.caption }}</span>
        </th>
      </tr>

      <tr
        v-for="row in group.rows"
        :key="row.key"
        class="measure"
      >
        <td class="value value-left viz-mono">
          {{ row.leftText }}
        </td>

        <th
          scope="row"
          class="gutter"
        >
          <span class="measure-label">{{ row.label }}</span>
          <span class="track">
            <span
              class="zero"
              aria-hidden="true"
            />
            <span
              class="fill"
              :style="fillStyle(row)"
            />
          </span>
          <span class="ratio viz-mono">{{ row.ratio }}</span>
        </th>

        <td class="value value-right viz-mono">
          {{ row.rightText }}
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.spine {
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  border-collapse: collapse;
  table-layout: fixed;
}

.head {
  padding: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  vertical-align: bottom;
  color: var(--viz-ink);
  border-bottom: 1px solid var(--viz-baseline);
}

.head-left,
.head-right {
  display: table-cell;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.head-left {
  text-align: left;
}

.head-right {
  text-align: right;
}

.head-gutter {
  width: clamp(104px, 30vw, 300px);
  text-align: center;
  font-weight: 500;
}

.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  vertical-align: 1px;
  margin-inline: 0 7px;
}

.head-right .dot {
  margin-inline: 7px 0;
}

.group-cell {
  padding: 26px 0 10px;
  text-align: left;
}

.group-caption {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  font-weight: 400;
  color: var(--viz-muted);
}

.measure > * {
  padding: 12px 0;
  border-top: 1px solid var(--viz-grid);
  vertical-align: middle;
}

.value {
  font-size: clamp(0.9rem, 2.2vw, 1.2rem);
  font-weight: 500;
  color: var(--viz-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.value-left {
  text-align: right;
  padding-right: 16px;
}

.value-right {
  text-align: left;
  padding-left: 16px;
}

.gutter {
  font-weight: 400;
  text-align: center;
}

.measure-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--viz-ink);
}

.track {
  display: block;
  position: relative;
  height: 10px;
  margin: 7px 0 5px;
  background: var(--viz-grid);
}

.zero {
  position: absolute;
  left: 50%;
  top: -3px;
  width: 1px;
  height: 16px;
  background: var(--viz-baseline);
}

.fill {
  position: absolute;
  top: 0;
  height: 10px;
  transition: width 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.ratio {
  display: block;
  font-size: 11px;
  color: var(--viz-muted);
}

@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>

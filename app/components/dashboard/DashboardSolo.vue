<script setup lang="ts">
import type { DeviceSummary } from '#shared/types'

const props = defineProps<{ summary: DeviceSummary }>()

const { colorFor } = useDeviceColors()

const color = computed(() => colorFor(props.summary.device))

const groups = computed(() => MEASURE_GROUPS.map(group => ({
  ...group,
  rows: measuresIn(group.id).map(measure => ({
    key: measure.key,
    label: measure.label,
    text: measure.display(measure.of(props.summary))
  }))
})))
</script>

<template>
  <div>
    <p class="viz-prose solo-note">
      <span
        class="dot"
        :style="{ backgroundColor: color }"
      />
      <span class="viz-mono">{{ summary.device }}</span> is the only machine reporting in this
      range, so there is nothing to compare it against. Here are its measures on their own.
    </p>

    <table class="solo">
      <caption class="sr-only">
        Every measure for {{ summary.device }}
      </caption>

      <tbody
        v-for="group in groups"
        :key="group.id"
      >
        <tr class="group">
          <th
            scope="colgroup"
            colspan="2"
            class="group-cell"
          >
            <span class="viz-eyebrow">{{ group.label }}</span>
          </th>
        </tr>

        <tr
          v-for="row in group.rows"
          :key="row.key"
          class="measure"
        >
          <th
            scope="row"
            class="label"
          >
            {{ row.label }}
          </th>
          <td class="value viz-mono">
            {{ row.text }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.solo-note {
  margin-bottom: 20px;
}

.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 7px;
}

.solo {
  width: 100%;
  max-width: 560px;
  border-collapse: collapse;
}

.group-cell {
  padding: 22px 0 8px;
  text-align: left;
}

.measure > * {
  padding: 11px 0;
  border-top: 1px solid var(--viz-grid);
}

.label {
  text-align: left;
  font-size: 13px;
  font-weight: 400;
  color: var(--viz-ink-secondary);
}

.value {
  text-align: right;
  font-size: clamp(0.95rem, 2.4vw, 1.3rem);
  font-weight: 500;
  color: var(--viz-ink);
  white-space: nowrap;
}
</style>

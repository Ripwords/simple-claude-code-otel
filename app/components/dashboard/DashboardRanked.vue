<script setup lang="ts">
import type { DeviceSummary } from '#shared/types'

const props = defineProps<{ summaries: DeviceSummary[] }>()

const { colorFor } = useDeviceColors()

const blocks = computed(() => MEASURE_GROUPS.map(group => ({
  ...group,
  measures: measuresIn(group.id).map((measure) => {
    const entries = props.summaries.map(summary => ({
      device: summary.device,
      color: colorFor(summary.device),
      raw: measure.of(summary),
      text: measure.display(measure.of(summary))
    }))
    const top = Math.max(0, ...entries.map(entry => entry.raw ?? 0))

    return {
      key: measure.key,
      label: measure.label,
      entries: [...entries]
        .sort((a, b) => (b.raw ?? -1) - (a.raw ?? -1))
        .map(entry => ({
          ...entry,
          extent: top > 0 && entry.raw !== null && entry.raw > 0 ? (entry.raw / top) * 100 : 0
        }))
    }
  })
})))
</script>

<template>
  <div>
    <p class="viz-prose ranked-note">
      {{ summaries.length }} machines are in view, so there is no single gap to read.
      Each measure below is ranked, and every bar is a share of that measure's leader.
    </p>

    <section
      v-for="group in blocks"
      :key="group.id"
      class="group"
    >
      <h3 class="viz-eyebrow group-head">
        {{ group.label }}
      </h3>

      <div class="grid">
        <div
          v-for="measure in group.measures"
          :key="measure.key"
          class="block"
        >
          <h4 class="block-label">
            {{ measure.label }}
          </h4>

          <dl class="rows">
            <div
              v-for="entry in measure.entries"
              :key="entry.device"
              class="row"
            >
              <dt class="viz-mono device">
                <span
                  class="dot"
                  :style="{ backgroundColor: entry.color }"
                />
                <span class="device-name">{{ entry.device }}</span>
              </dt>
              <dd class="track">
                <span
                  class="fill"
                  :style="{ width: `max(2px, ${entry.extent}%)`, background: entry.color }"
                />
              </dd>
              <dd class="viz-mono amount">
                {{ entry.text }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ranked-note {
  margin-bottom: 24px;
}

.group + .group {
  margin-top: 34px;
}

.group-head {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--viz-baseline);
}

.grid {
  display: grid;
  gap: 26px 40px;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  margin-top: 20px;
}

.block-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--viz-ink-secondary);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--viz-grid);
}

.rows {
  margin: 0;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34% auto;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}

.device {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  color: var(--viz-ink-secondary);
}

.device-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  width: 8px;
  height: 8px;
  flex: none;
}

.track {
  margin: 0;
  height: 8px;
  background: var(--viz-grid);
}

.fill {
  display: block;
  height: 8px;
}

.amount {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
  color: var(--viz-ink);
}
</style>

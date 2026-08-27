<script setup lang="ts">
import type { DeviceSummary } from '#shared/types'
import { UNLABELLED_DEVICE } from '#shared/types'

const props = defineProps<{ summaries: DeviceSummary[] }>()

/**
 * The comparison answers "which of my machines", so only named machines are in
 * it. Unlabelled telemetry is real spend and is never dropped, but it has no
 * identity to compare, so it is accounted for underneath instead of taking a
 * column it cannot fill.
 */
const named = computed(() => props.summaries
  .filter(summary => summary.device !== UNLABELLED_DEVICE)
  .sort((a, b) => a.device.localeCompare(b.device)))

const unattributed = computed(() => props.summaries.find(summary => summary.device === UNLABELLED_DEVICE) ?? null)
</script>

<template>
  <div>
    <DashboardSpine
      v-if="named.length === 2"
      :summaries="named"
    />
    <DashboardSolo
      v-else-if="named.length === 1"
      :summary="named[0]!"
    />
    <DashboardRanked
      v-else-if="named.length > 2"
      :summaries="named"
    />
    <p
      v-else
      class="viz-prose"
    >
      No named machine reported in this range. Widen the range, or clear the machine filter.
    </p>

    <p
      v-if="unattributed"
      class="unattributed viz-prose"
    >
      <span class="viz-code">{{ UNLABELLED_DEVICE }}</span> also spent
      <span class="viz-mono">{{ formatUsd(unattributed.costUsd) }}</span> over
      <span class="viz-mono">{{ formatDuration(unattributed.activeSeconds) }}</span> here. It is
      counted in every chart below but kept out of the comparison, because telemetry with no
      device name cannot be attributed to a machine.
    </p>
  </div>
</template>

<style scoped>
.unattributed {
  margin-top: 26px;
  padding-top: 14px;
  border-top: 1px solid var(--viz-grid);
  max-width: 68ch;
  font-size: 13px;
  color: var(--viz-muted);
}
</style>

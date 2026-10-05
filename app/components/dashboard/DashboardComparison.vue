<script setup lang="ts">
import type { BreakdownRow, DeviceSummary } from '#shared/types'

const props = defineProps<{ summaries: DeviceSummary[], costByModel: BreakdownRow[] }>()

const ordered = computed(() => [...props.summaries].sort((a, b) => a.device.localeCompare(b.device)))
</script>

<template>
  <div>
    <!-- Two machines have one gap worth reading side by side; any other count reads best as a ranked table. -->
    <DashboardSpine
      v-if="ordered.length === 2"
      :summaries="ordered"
    />
    <DashboardLeaderboard
      v-else-if="ordered.length > 0"
      :summaries="ordered"
      :cost-by-model="costByModel"
    />
    <p
      v-else
      class="viz-prose"
    >
      No machine reported in this range. Widen the range, or clear the machine filter.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { DeviceSummary } from '#shared/types'

const props = defineProps<{ summaries: DeviceSummary[] }>()

const ordered = computed(() => [...props.summaries].sort((a, b) => a.device.localeCompare(b.device)))
</script>

<template>
  <div>
    <DashboardSpine
      v-if="ordered.length === 2"
      :summaries="ordered"
    />
    <DashboardSolo
      v-else-if="ordered.length === 1"
      :summary="ordered[0]!"
    />
    <DashboardRanked
      v-else-if="ordered.length > 2"
      :summaries="ordered"
    />
    <p
      v-else
      class="viz-prose"
    >
      No machine reported in this range. Widen the range, or clear the machine filter.
    </p>
  </div>
</template>

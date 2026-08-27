<script setup lang="ts">
import type { DeviceStatus } from '#shared/types'

defineProps<{ status: DeviceStatus, at?: string | null }>()
</script>

<template>
  <span
    class="status"
    :data-status="status"
  >
    <span class="line">
      <DeviceStatusMark :mark="STATUS[status].mark" />
      <span class="word viz-mono">{{ STATUS[status].word }}</span>
    </span>
    <span class="sr-only">. {{ STATUS[status].line }}</span>
    <span
      v-if="at"
      class="since viz-mono"
    >since {{ formatStamp(at) }}</span>
  </span>
</template>

<style scoped>
.status {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.since {
  font-size: 11px;
  white-space: nowrap;
  color: var(--viz-muted);
}

/* Colour is keyed on the data attribute, never bound from JS, because it is
   static per state. It is also redundant: the word and the glyph carry it. */
[data-status="pending"] .mark {
  color: var(--viz-status-warning);
}

[data-status="reporting"] .mark {
  color: var(--viz-status-good);
}

[data-status="revoked"] .mark {
  color: var(--viz-muted);
}

.word {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--viz-ink);
}
</style>

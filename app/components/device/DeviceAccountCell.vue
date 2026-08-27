<script setup lang="ts">
import type { DeviceInfo } from '#shared/types'

const props = defineProps<{ device: DeviceInfo }>()

const binding = computed(() => bindingOf(props.device))
const owner = computed(() => props.device.account ? accountLabel(props.device.account) : null)
</script>

<template>
  <span
    class="account"
    :data-binding="binding"
  >
    <template v-if="owner">
      <span class="owner viz-mono">{{ owner }}</span>
      <span
        v-if="device.conflict"
        class="refused"
      >
        <DeviceConflictMark />
        <span class="refused-word viz-mono">Refusing another account</span>
      </span>
    </template>

    <template v-else>
      <span class="unclaimed viz-mono">Unclaimed</span>
      <span class="hint">Binds to the first account that reports.</span>
    </template>
  </span>
</template>

<style scoped>
.account {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.owner {
  font-size: 12.5px;
  overflow-wrap: anywhere;
  color: var(--viz-ink);
}

.unclaimed {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--viz-ink-secondary);
}

.hint {
  font-size: 11px;
  line-height: 1.45;
  white-space: normal;
  max-width: 26ch;
  color: var(--viz-muted);
}

/* A refusal is a failure of the pipeline, not a category of machine, so it takes
   the status palette. The glyph and the word carry it without the colour. */
.refused {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--viz-status-critical);
}

.refused-word {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>

<script setup lang="ts">
import type { DeviceInfo } from '#shared/types'
import type { DeviceAction } from '~/utils/deviceStatus'

const props = defineProps<{ device: DeviceInfo, open: DeviceAction | null }>()

defineEmits<{ act: [action: DeviceAction] }>()

const actions = computed(() => actionsFor(props.device))
</script>

<template>
  <div class="actions">
    <button
      v-for="action in actions"
      :key="action"
      type="button"
      class="action viz-mono viz-focus"
      :class="{ 'action--open': open === action }"
      :aria-label="ACTION[action].aria(device.name)"
      :aria-expanded="open === action"
      @click="$emit('act', action)"
    >
      {{ ACTION[action].label }}
    </button>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.action {
  padding: 4px 10px;
  border: 1px solid var(--viz-grid);
  background: transparent;
  color: var(--viz-ink-secondary);
  font-size: 11px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
}

.action:hover {
  border-color: var(--viz-ink);
  color: var(--viz-ink);
}

.action--open {
  border-color: var(--viz-ink);
  background: var(--viz-ink);
  color: var(--viz-surface);
}
</style>

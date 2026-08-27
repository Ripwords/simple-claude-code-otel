<script setup lang="ts">
import type { DeviceInfo } from '#shared/types'

const props = defineProps<{ device: DeviceInfo, otlpEndpoint: string }>()

defineEmits<{ rotate: [] }>()

const command = computed(() => setupCommand(props.otlpEndpoint, TOKEN_PLACEHOLDER))
</script>

<template>
  <div class="setup">
    <p class="viz-eyebrow">
      Set up this machine
    </p>

    <p class="viz-prose">
      <span class="viz-mono">{{ device.name }}</span> has not reported yet. Run this on it, filling in
      the token you were shown when you added it.
    </p>

    <code class="command viz-mono">{{ command }}</code>

    <p class="viz-prose muted">
      You cannot see that token again. Rotate to issue a new one.
    </p>

    <button
      type="button"
      class="rotate viz-mono viz-focus"
      :aria-label="`Rotate token for ${device.name} and show the new one`"
      @click="$emit('rotate')"
    >
      Rotate
    </button>
  </div>
</template>

<style scoped>
.setup {
  padding: 4px 0 6px;
  max-width: 72ch;
}

.command {
  display: block;
  margin: 12px 0;
  padding: 12px 14px;
  border: 1px solid var(--viz-grid);
  background: var(--viz-page);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: all;
  color: var(--viz-ink-secondary);
}

.muted {
  color: var(--viz-muted);
}

.rotate {
  margin-top: 12px;
  padding: 7px 16px;
  border: 1px solid var(--viz-ink);
  background: var(--viz-ink);
  color: var(--viz-surface);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}
</style>

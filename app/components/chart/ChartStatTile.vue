<script setup lang="ts">
interface Props {
  label: string
  value: string
  hint?: string
  accent?: string
}

const props = withDefaults(defineProps<Props>(), {
  hint: undefined,
  accent: undefined
})

const rule = computed(() => (props.accent ? { borderLeft: `3px solid ${props.accent}`, paddingLeft: '12px' } : undefined))
</script>

<template>
  <div
    class="tile"
    :style="rule"
  >
    <div class="tile-label">
      {{ label }}
    </div>
    <div class="tile-value">
      {{ value }}
    </div>
    <div
      v-if="hint"
      class="tile-hint"
    >
      {{ hint }}
    </div>
  </div>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tile-label {
  font-size: 11px;
  line-height: 1.4;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--viz-muted);
}

.tile-value {
  font-size: 1.75rem;
  line-height: 1.15;
  font-variant-numeric: normal;
  color: var(--viz-ink);
}

.tile-hint {
  font-size: 12px;
  line-height: 1.4;
  color: var(--viz-ink-secondary);
}
</style>

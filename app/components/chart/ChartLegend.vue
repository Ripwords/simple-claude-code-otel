<script setup lang="ts">
interface LegendItem {
  label: string
  color: string
}

defineProps<{ items: LegendItem[] }>()
</script>

<template>
  <ul class="legend">
    <li
      v-for="item in items"
      :key="item.label"
      class="legend-item"
    >
      <span
        class="legend-swatch"
        :style="{ background: item.color }"
      />
      <span class="viz-mono">{{ item.label }}</span>
    </li>
  </ul>
</template>

<style scoped>
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3xs) var(--space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-xs);
  color: var(--viz-ink-secondary);
  line-height: 1.4;
}

.legend-swatch {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}
</style>

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
      <span>{{ item.label }}</span>
    </li>
  </ul>
</template>

<style scoped>
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--viz-ink-secondary);
}

.legend-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: none;
}
</style>

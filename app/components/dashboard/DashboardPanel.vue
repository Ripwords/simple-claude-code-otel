<script setup lang="ts">
defineProps<{ eyebrow: string, note?: string }>()
</script>

<template>
  <section class="panel">
    <div class="head">
      <h3 class="viz-eyebrow">
        {{ eyebrow }}
      </h3>
      <p
        v-if="note"
        class="note"
      >
        {{ note }}
      </p>
    </div>

    <slot />
  </section>
</template>

<style scoped>
.panel {
  min-width: 0;
}

.head {
  padding-bottom: 8px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--viz-grid);
}

.note {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--viz-muted);
}
</style>

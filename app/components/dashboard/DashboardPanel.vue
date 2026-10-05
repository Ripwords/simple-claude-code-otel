<script setup lang="ts">
defineProps<{ title: string, note?: string }>()
</script>

<template>
  <section class="panel">
    <header class="head">
      <div class="titles">
        <h2 class="viz-heading">
          {{ title }}
        </h2>
        <p
          v-if="note"
          class="viz-note note"
        >
          {{ note }}
        </p>
      </div>
      <slot name="actions" />
    </header>

    <slot />
  </section>
</template>

<style scoped>
.panel {
  min-width: 0;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-xs) var(--space-md);
  margin-bottom: var(--space-md);
}

.titles {
  min-width: 0;
}

.note {
  margin-top: var(--space-3xs);
  max-width: 60ch;
}
</style>

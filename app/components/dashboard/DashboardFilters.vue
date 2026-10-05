<script setup lang="ts">
const { preset, selectedDevices, setPreset, setDevices } = useDashboardQuery()
const { data: devices } = useDevices()
const { colorFor } = useDeviceColors()

/** A revoked machine keeps its history, so it stays filterable. */
const options = computed(() => (devices.value ?? [])
  .map(device => ({ label: device.name, value: device.id }))
  .sort((a, b) => a.label.localeCompare(b.label)))

const selection = computed({
  get: () => selectedDevices.value,
  set: (value: string[]) => setDevices(value)
})

const selectionLabel = computed(() => {
  if (selection.value.length === 0) {
    return options.value.length === 1 ? 'The only machine' : `All ${options.value.length} machines`
  }
  if (selection.value.length > 1) return `${selection.value.length} machines`
  // Never fall back to the id: a uuid must not surface in this control.
  return options.value.find(option => option.value === selection.value[0])?.label ?? '1 machine'
})
</script>

<template>
  <div class="filters">
    <div
      class="range viz-segmented"
      role="group"
      aria-label="Date range"
    >
      <button
        v-for="option in RANGE_PRESETS"
        :key="option.id"
        type="button"
        class="viz-segment"
        :aria-pressed="option.id === preset.id"
        @click="setPreset(option.id)"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="status-slot">
      <slot />
    </div>

    <USelectMenu
      v-model="selection"
      multiple
      :items="options"
      value-key="value"
      :search-input="{ placeholder: 'Filter machines' }"
      :ui="{ content: 'viz-root' }"
      color="neutral"
      variant="outline"
      class="picker viz-mono"
      aria-label="Machines"
    >
      <template #default>
        <span class="truncate">{{ selectionLabel }}</span>
      </template>

      <template #item-leading="{ item }">
        <span
          class="swatch"
          :style="{ backgroundColor: colorFor(item.value) }"
        />
      </template>
    </USelectMenu>
  </div>
</template>

<style scoped>
/* Status gets its own row: squeezed between the controls, three notices wrap to two lines. */
.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "range picker"
    "status status";
  align-items: center;
  gap: var(--space-xs) var(--space-md);
}

.range {
  grid-area: range;
}

.status-slot {
  grid-area: status;
  min-width: 0;
}

.picker {
  grid-area: picker;
  min-width: 12rem;
  font-size: var(--text-xs);
  color: var(--viz-ink);
}

.swatch {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
}

@media (width < 560px) {
  .filters {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "range"
      "picker"
      "status";
  }

  .range {
    overflow-x: auto;
    max-width: 100%;
  }

  .picker {
    width: 100%;
  }
}
</style>

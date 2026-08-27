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
  if (selection.value.length === 0) return `All ${options.value.length} machines`
  if (selection.value.length > 1) return `${selection.value.length} machines`
  // Never fall back to the id: a uuid must not surface in this control.
  return options.value.find(option => option.value === selection.value[0])?.label ?? '1 machine'
})
</script>

<template>
  <div class="filters">
    <div
      class="range"
      role="group"
      aria-label="Date range"
    >
      <button
        v-for="option in RANGE_PRESETS"
        :key="option.id"
        type="button"
        class="range-option viz-mono viz-focus"
        :class="{ 'is-active': option.id === preset.id }"
        :aria-pressed="option.id === preset.id"
        @click="setPreset(option.id)"
      >
        {{ option.label }}
      </button>
    </div>

    <USelectMenu
      v-model="selection"
      multiple
      :items="options"
      value-key="value"
      :search-input="{ placeholder: 'Filter machines' }"
      :ui="{ content: 'viz-root' }"
      color="neutral"
      variant="none"
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
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  padding: 10px 0;
  border-top: 1px solid var(--viz-grid);
  border-bottom: 1px solid var(--viz-grid);
}

.range {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.range-option {
  padding: 5px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--viz-muted);
  font-size: 12px;
  cursor: pointer;
}

.range-option:hover {
  color: var(--viz-ink);
}

.range-option.is-active {
  color: var(--viz-ink);
  border-bottom-color: var(--viz-ink);
}

.picker {
  min-width: 13rem;
  font-size: 12px;
  color: var(--viz-ink);
}

.swatch {
  width: 9px;
  height: 9px;
  flex: none;
}
</style>

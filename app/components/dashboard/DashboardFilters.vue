<script setup lang="ts">
import type { DeviceInfo } from '#shared/types'

const { preset, selectedDevices, setPreset, setDevices } = useDashboardQuery()
const { data: devices } = useDevices()
const { colorFor } = useDeviceColors()

const deviceNames = computed(() => (devices.value ?? []).map((d: DeviceInfo) => d.device).sort((a, b) => a.localeCompare(b)))

const selection = computed({
  get: () => selectedDevices.value,
  set: (value: string[]) => setDevices(value)
})

const selectionLabel = computed(() => {
  if (selection.value.length === 0) return 'All devices'
  if (selection.value.length === 1) return selection.value[0]!
  return `${selection.value.length} devices`
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <UFieldGroup
      role="group"
      aria-label="Date range"
    >
      <UButton
        v-for="option in RANGE_PRESETS"
        :key="option.id"
        :label="option.label"
        color="neutral"
        :variant="option.id === preset.id ? 'solid' : 'outline'"
        :aria-pressed="option.id === preset.id"
        @click="setPreset(option.id)"
      />
    </UFieldGroup>

    <USelectMenu
      v-model="selection"
      multiple
      :items="deviceNames"
      :search-input="{ placeholder: 'Filter devices' }"
      :ui="{ content: 'viz-root' }"
      color="neutral"
      variant="outline"
      class="min-w-52"
      aria-label="Devices"
    >
      <template #default>
        <span class="truncate">{{ selectionLabel }}</span>
      </template>

      <template #item-leading="{ item }">
        <span
          class="size-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: colorFor(item) }"
        />
      </template>
    </USelectMenu>

    <span
      v-if="selection.length === 0"
      class="text-sm"
      :style="{ color: 'var(--viz-ink-secondary)' }"
    >
      Showing every device
    </span>
  </div>
</template>

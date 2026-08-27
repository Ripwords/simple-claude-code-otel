<script setup lang="ts">
import type { StatusMark } from '~/utils/deviceStatus'

defineProps<{ mark: StatusMark }>()
</script>

<template>
  <svg
    class="mark"
    viewBox="0 0 12 12"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      cx="6"
      cy="6"
      r="4.25"
      :fill="mark === 'disc' ? 'currentColor' : 'none'"
      :stroke="mark === 'disc' ? 'none' : 'currentColor'"
      stroke-width="1.75"
    />
    <line
      v-if="mark === 'barred'"
      x1="2.1"
      y1="9.9"
      x2="9.9"
      y2="2.1"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="square"
    />
  </svg>
</template>

<style scoped>
.mark {
  display: block;
  width: 10px;
  height: 10px;
  flex: none;
  overflow: visible;
}
</style>

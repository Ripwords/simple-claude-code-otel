<script setup lang="ts">
defineProps<{ busy: boolean, failure: string | null }>()

const emit = defineEmits<{ submit: [] }>()

const name = defineModel<string>({ required: true })
const fieldId = useId()
</script>

<template>
  <form
    class="add"
    @submit.prevent="emit('submit')"
  >
    <div class="line">
      <label
        class="label viz-mono"
        :for="fieldId"
      >Add a machine</label>

      <div class="controls">
        <input
          :id="fieldId"
          v-model="name"
          class="field viz-mono viz-focus"
          type="text"
          placeholder="work-mac"
          :maxlength="DEVICE_NAME_MAX"
          autocomplete="off"
          spellcheck="false"
        >

        <button
          type="submit"
          class="submit viz-mono viz-focus"
          :disabled="busy"
        >
          {{ busy ? 'Minting…' : 'Add and mint a token' }}
        </button>
      </div>
    </div>

    <p class="viz-prose hint">
      The name is a label. Identity is the token, so you can rename it later without losing a
      single data point.
    </p>

    <p
      v-if="failure"
      class="failure"
      role="alert"
    >
      {{ failure }}
    </p>
  </form>
</template>

<style scoped>
.add {
  padding: 20px 0 24px;
  border-top: 1px solid var(--viz-grid);
}

.label {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--viz-ink-secondary);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.field {
  flex: 1 1 18ch;
  min-width: 0;
  max-width: 34ch;
  padding: 8px 10px;
  border: 1px solid var(--viz-baseline);
  background: var(--viz-surface);
  color: var(--viz-ink);
  font-size: 13px;
}

.submit {
  padding: 8px 18px;
  border: 1px solid var(--viz-ink);
  background: var(--viz-ink);
  color: var(--viz-surface);
  font-size: 12px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
}

.submit:disabled {
  border-color: var(--viz-grid);
  background: transparent;
  color: var(--viz-muted);
  cursor: progress;
}

.hint {
  margin-top: 12px;
  color: var(--viz-muted);
}

.failure {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--viz-status-critical);
}
</style>

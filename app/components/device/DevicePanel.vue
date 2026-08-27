<script setup lang="ts">
import type { PanelResult, RowPane } from '~/utils/deviceStatus'

const props = defineProps<{ pane: RowPane, busy: boolean, failure: string | null }>()

const emit = defineEmits<{ confirm: [result: PanelResult], cancel: [] }>()

const fieldId = useId()
const typed = ref(props.pane.action === 'rename' ? props.pane.device.name : '')
const field = ref<HTMLInputElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)

const device = computed(() => props.pane.device)
const typesToConfirm = computed(() => props.pane.action === 'delete')
const matched = computed(() => typed.value.trim() === device.value.name)

const CONFIRM_LABEL: Record<PanelResult['action'], string> = {
  rename: 'Save name',
  rotate: 'Mint a new token',
  revoke: 'Revoke the token',
  delete: 'Delete this machine'
}

function submit() {
  if (props.busy) return
  if (props.pane.action === 'rename') {
    emit('confirm', { action: 'rename', name: typed.value })
    return
  }
  if (props.pane.action === 'delete' && !matched.value) return
  emit('confirm', { action: props.pane.action })
}

onMounted(() => {
  if (field.value) field.value.focus()
  else confirmButton.value?.focus()
})
</script>

<template>
  <form
    class="panel"
    @submit.prevent="submit"
  >
    <p class="viz-eyebrow">
      {{ ACTION[pane.action].aria(device.name) }}
    </p>

    <template v-if="pane.action === 'rename'">
      <p class="viz-prose">
        Renaming keeps every metric point and event this machine ever sent. Identity is the token,
        not the name, so nothing forks and no history moves.
      </p>

      <label
        class="label viz-mono"
        :for="fieldId"
      >New name</label>
      <input
        :id="fieldId"
        ref="field"
        v-model="typed"
        class="field viz-mono viz-focus"
        type="text"
        :maxlength="DEVICE_NAME_MAX"
        autocomplete="off"
        spellcheck="false"
      >
    </template>

    <template v-else-if="pane.action === 'rotate'">
      <p class="viz-prose">
        {{ STATUS[device.status].rotateWarning(device.name) }}
      </p>
      <p class="viz-prose muted">
        Minting is itself the destructive act. The new token is shown once, on the next screen.
      </p>
    </template>

    <template v-else-if="pane.action === 'revoke'">
      <p class="viz-prose">
        Ingest stops the moment this lands. <span class="viz-mono">{{ device.name }}</span> keeps its
        history and stays in every chart.
      </p>
      <p class="viz-prose muted">
        Rotating a new token later puts it back into service.
      </p>
    </template>

    <template v-else>
      <p class="viz-prose">
        This destroys <span class="viz-mono">{{ device.name }}</span> and everything it sent:
        {{ formatCount(device.sessions) }} {{ device.sessions === 1 ? 'session' : 'sessions' }},
        every metric point and every event. It cascades in the database and cannot be undone.
      </p>

      <label
        class="label viz-mono"
        :for="fieldId"
      >Type {{ device.name }} to confirm</label>
      <input
        :id="fieldId"
        ref="field"
        v-model="typed"
        class="field viz-mono viz-focus"
        type="text"
        autocomplete="off"
        spellcheck="false"
      >
    </template>

    <div class="row">
      <button
        ref="confirmButton"
        type="submit"
        class="confirm viz-mono viz-focus"
        :disabled="busy || (typesToConfirm && !matched)"
      >
        {{ busy ? 'Working…' : CONFIRM_LABEL[pane.action] }}
      </button>

      <button
        type="button"
        class="cancel viz-mono viz-focus"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>

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
.panel {
  padding: 4px 0 6px;
  max-width: 72ch;
}

.viz-prose {
  margin-top: 8px;
}

.muted {
  color: var(--viz-muted);
}

.label {
  display: block;
  margin: 14px 0 6px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--viz-ink-secondary);
}

.field {
  display: block;
  width: min(38ch, 100%);
  padding: 8px 10px;
  border: 1px solid var(--viz-baseline);
  background: var(--viz-surface);
  color: var(--viz-ink);
  font-size: 13px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.confirm {
  padding: 7px 16px;
  border: 1px solid var(--viz-ink);
  background: var(--viz-ink);
  color: var(--viz-surface);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.confirm:disabled {
  border-color: var(--viz-grid);
  background: transparent;
  color: var(--viz-muted);
  cursor: not-allowed;
}

.cancel {
  padding: 7px 16px;
  border: 1px solid var(--viz-grid);
  background: transparent;
  color: var(--viz-ink-secondary);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.failure {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--viz-status-critical);
}
</style>

<script setup lang="ts">
import type { AllowedEmail } from '#shared/types'

defineProps<{
  entries: AllowedEmail[]
  unavailable: boolean
  busy: boolean
  failure: string | null
}>()

const emit = defineEmits<{ submit: [], remove: [email: string] }>()

const email = defineModel<string>({ required: true })
const fieldId = useId()
</script>

<template>
  <section class="allowlist">
    <p class="viz-eyebrow">
      Allowed accounts
    </p>
    <h2 class="headline">
      Accounts that may report from any machine
    </h2>
    <p class="viz-prose">
      An account whose email is on this list may report from any machine, even one whose token is
      bound to someone else. Its telemetry lands under the machine that sent it, and that machine
      stays bound to the account it already claimed. Every account that owns a machine here is on
      the list automatically, which is why nobody has to be added to report from their own.
    </p>

    <p
      v-if="unavailable"
      class="viz-prose hint"
    >
      <span class="viz-code">GET /api/allowlist</span> answered 404, so there is nothing here to
      read and nothing to change. Deploy the allowlist routes and reload.
    </p>

    <template v-else>
      <form
        class="add"
        @submit.prevent="emit('submit')"
      >
        <label
          class="label viz-mono"
          :for="fieldId"
        >Allow an account</label>

        <div class="controls">
          <input
            :id="fieldId"
            v-model="email"
            class="field viz-mono viz-focus"
            type="email"
            placeholder="teammate@example.com"
            autocomplete="off"
            spellcheck="false"
          >

          <button
            type="submit"
            class="submit viz-mono viz-focus"
            :disabled="busy"
          >
            {{ busy ? 'Saving…' : 'Allow this account' }}
          </button>
        </div>
      </form>

      <p
        v-if="failure"
        class="failure"
        role="alert"
      >
        {{ failure }}
      </p>

      <p
        v-if="entries.length === 0"
        class="viz-no-data viz-mono"
      >
        No account is allowed anywhere yet.
      </p>

      <ul
        v-else
        class="rows"
      >
        <li
          v-for="entry in entries"
          :key="entry.email"
          class="row"
        >
          <span class="viz-mono address">{{ entry.email }}</span>

          <p
            v-if="entry.source === 'device'"
            class="viz-prose source"
          >
            On the list because a machine's token is claimed by this account. Release or delete
            that machine to take it off.
          </p>

          <button
            v-else
            type="button"
            class="drop viz-mono viz-focus"
            :disabled="busy"
            :aria-label="`Stop allowing ${entry.email} on every machine`"
            @click="emit('remove', entry.email)"
          >
            Remove
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.allowlist {
  padding: 22px 0 24px;
  margin-top: 24px;
  border-top: 1px solid var(--viz-grid);
  max-width: 72ch;
}

.headline {
  margin: 10px 0 12px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--viz-ink);
}

.add {
  margin-top: 20px;
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
  flex: 1 1 20ch;
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

.rows {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 18px;
  padding: 11px 0;
  border-bottom: 1px solid var(--viz-grid);
}

.address {
  font-size: 13px;
  overflow-wrap: anywhere;
  color: var(--viz-ink);
}

.source {
  flex: 1 1 28ch;
  margin: 0;
  color: var(--viz-muted);
}

.drop {
  padding: 5px 14px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.drop:disabled {
  border-color: var(--viz-grid);
  color: var(--viz-muted);
  cursor: progress;
}
</style>

<script setup lang="ts">
import type { DeviceAccountConflict, DeviceInfo } from '#shared/types'

const props = defineProps<{ device: DeviceInfo, conflict: DeviceAccountConflict }>()

const emit = defineEmits<{ release: [], allow: [email: string] }>()

const owner = computed(() => props.device.account ? accountLabel(props.device.account) : 'the account that claimed it')
const refused = computed(() => accountLabel(props.conflict))
const attempts = computed(() => props.conflict.count === 1 ? 'once' : `${formatCount(props.conflict.count)} times`)

function allow() {
  if (props.conflict.email) emit('allow', props.conflict.email)
}
</script>

<template>
  <div class="conflict">
    <p class="eyebrow viz-eyebrow">
      <DeviceConflictMark />
      <span>Telemetry refused</span>
    </p>

    <h3 class="headline">
      <span class="viz-mono">{{ device.name }}</span> is reporting under a different account
    </h3>

    <p class="viz-prose">
      Telemetry arrived from this machine under a Claude Code account that is not the one its token
      belongs to, and was turned away {{ attempts }}, most recently
      <span class="viz-mono">{{ formatStamp(conflict.at) }}</span>. None of it entered your data.
      Until that changes, this machine adds nothing to any chart on the dashboard.
    </p>

    <dl class="pair">
      <div>
        <dt class="viz-eyebrow">
          Token belongs to
        </dt>
        <dd class="viz-mono">
          {{ owner }}
        </dd>
      </div>
      <div>
        <dt class="viz-eyebrow">
          Account refused
        </dt>
        <dd class="viz-mono">
          {{ refused }}
        </dd>
      </div>
    </dl>

    <p class="viz-prose">
      There are three ways out. Sign back into <span class="viz-mono">{{ owner }}</span> on that
      machine and reporting resumes by itself, with nothing to change here. Release the binding,
      which drops the claim so the next account to report takes the machine over. Or allow this
      account, which lets its telemetry land from this machine while the machine stays bound to
      <span class="viz-mono">{{ owner }}</span>.
    </p>

    <div class="choices">
      <button
        type="button"
        class="release viz-mono viz-focus"
        :aria-label="ACTION.release.aria(device.name)"
        @click="emit('release')"
      >
        Release the binding
      </button>

      <button
        v-if="conflict.email"
        type="button"
        class="allow viz-mono viz-focus"
        :aria-label="`Allow ${refused} to report from every machine`"
        @click="allow"
      >
        Allow this account
      </button>
    </div>
  </div>
</template>

<style scoped>
/* The rule and the glyph say the same thing twice, so the state survives a
   greyscale screen and a colourblind reader alike. */
.conflict {
  padding: 2px 0 6px 14px;
  border-left: 3px solid var(--viz-status-critical);
  max-width: 72ch;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--viz-status-critical);
}

.headline {
  margin: 8px 0 4px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  white-space: normal;
  color: var(--viz-ink);
}

.viz-prose {
  margin: 8px 0 0;
  white-space: normal;
}

.pair {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 32px;
  margin: 14px 0 0;
}

.pair dd {
  margin: 4px 0 0;
  font-size: 13px;
  overflow-wrap: anywhere;
  color: var(--viz-ink);
}

.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.release {
  padding: 7px 16px;
  border: 1px solid var(--viz-ink);
  background: var(--viz-ink);
  color: var(--viz-surface);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.allow {
  padding: 7px 16px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}
</style>

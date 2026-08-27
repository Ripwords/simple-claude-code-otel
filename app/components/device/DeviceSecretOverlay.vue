<script setup lang="ts">
import type { DeviceSecret } from '#shared/types'
import type { SecretReason } from '~/utils/deviceStatus'

interface Props {
  secret: DeviceSecret
  reason: SecretReason
  otlpEndpoint: string
}

const props = defineProps<Props>()

const emit = defineEmits<{ dismiss: [] }>()

/** One union rather than two booleans, so "confirming" and "already copied" cannot both hold. */
type ExitState = { kind: 'armed' } | { kind: 'confirming' } | { kind: 'safe' }

const exit = ref<ExitState>({ kind: 'armed' })
const frame = ref<HTMLElement | null>(null)
const commandRef = ref<{ focusPrimary: () => void, copyCommand: () => Promise<void> } | null>(null)
const confirmCopy = ref<HTMLButtonElement | null>(null)
const announcement = ref('')

const name = computed(() => props.secret.device.name)
const command = computed(() => setupCommand(props.otlpEndpoint, props.secret.token))
const reported = computed(() => props.secret.device.firstSeen !== null)

const copy = computed(() => {
  if (props.reason === 'minted') {
    return {
      eyebrow: 'Shown once',
      headline: 'This token will not be shown again',
      body: `Run this on ${name.value}. It writes the telemetry block into ~/.claude/settings.json and starts a new Claude Code session reporting here.`,
      aside: 'The dashboard keeps only a hash and the prefix above. Nobody, including you, can read this token back.',
      dismiss: 'I have saved the token',
      leaving: 'You have not copied it. Leaving destroys it.'
    }
  }

  return {
    eyebrow: 'Shown once · Rotated',
    headline: reported.value ? `${name.value}'s old token stopped working` : `${name.value} has a new token`,
    body: reported.value
      ? `The old credential died the moment this one was minted. Until you run this, ${name.value} reports nothing.`
      : `The credential minted before this one is dead. ${name.value} has never reported, so this is the command that brings it online.`,
    aside: 'Anything still using the old token gets 401. That is the point of rotating.',
    dismiss: 'I have saved the new token',
    leaving: `You have not copied it. Leaving destroys it, and ${name.value} stays offline.`
  }
})

function onCopied(what: 'command' | 'token') {
  exit.value = { kind: 'safe' }
  announcement.value = what === 'command' ? 'Command copied to clipboard' : 'Token copied to clipboard'
}

function requestDismiss() {
  if (exit.value.kind === 'safe') {
    emit('dismiss')
    return
  }
  exit.value = { kind: 'confirming' }
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function trap(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !frame.value) return

  const nodes = [...frame.value.querySelectorAll<HTMLElement>(FOCUSABLE)]
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (!first || !last) return

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function guardUnload(event: BeforeUnloadEvent) {
  if (exit.value.kind === 'safe') return
  event.preventDefault()
  // Safari and older Chrome still gate the prompt on a non-empty returnValue.
  event.returnValue = ''
}

watch(() => exit.value.kind, async (kind) => {
  if (kind !== 'confirming') return
  await nextTick()
  confirmCopy.value?.focus()
})

onBeforeRouteLeave(() => {
  if (exit.value.kind === 'safe') return true
  exit.value = { kind: 'confirming' }
  return false
})

onMounted(() => {
  document.body.style.overflow = 'hidden'
  window.addEventListener('beforeunload', guardUnload)
  commandRef.value?.focusPrimary()
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('beforeunload', guardUnload)
})
</script>

<template>
  <div
    class="overlay viz-root"
    role="group"
    :aria-label="copy.headline"
    @keydown="trap"
  >
    <div
      ref="frame"
      class="frame"
    >
      <div class="column">
        <div class="meta-row">
          <p class="viz-eyebrow">
            {{ copy.eyebrow }}
          </p>
          <p class="meta viz-mono">
            {{ name }} · {{ secret.device.tokenPrefix }}
          </p>
        </div>

        <h2 class="headline">
          {{ copy.headline }}
        </h2>

        <p class="viz-prose">
          {{ copy.body }}
        </p>

        <p class="viz-prose aside">
          {{ copy.aside }}
        </p>

        <DeviceSecretCommand
          ref="commandRef"
          :command="command"
          :token="secret.token"
          @copied="onCopied"
        />

        <div
          v-if="exit.kind === 'confirming'"
          class="confirm"
        >
          <p class="warning viz-prose">
            {{ copy.leaving }}
          </p>

          <div class="row">
            <button
              ref="confirmCopy"
              type="button"
              class="button viz-mono viz-focus"
              aria-label="Copy command and stay on this screen"
              @click="commandRef?.copyCommand()"
            >
              Copy command
            </button>

            <button
              type="button"
              class="button button--quiet viz-mono viz-focus"
              @click="emit('dismiss')"
            >
              Leave anyway
            </button>
          </div>
        </div>

        <div
          v-else
          class="row"
        >
          <button
            type="button"
            class="button viz-mono viz-focus"
            @click="requestDismiss"
          >
            {{ copy.dismiss }}
          </button>

          <p
            v-if="exit.kind === 'safe'"
            class="footnote viz-prose"
          >
            Paste it into a terminal on <span class="viz-mono">{{ name }}</span> before you leave this screen.
          </p>
        </div>

        <p
          class="sr-only"
          aria-live="polite"
        >
          {{ announcement }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: var(--viz-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.frame {
  display: flex;
  min-height: calc(100dvh - 2 * clamp(10px, 2vw, 24px));
  margin: clamp(10px, 2vw, 24px);
  padding: clamp(24px, 5vw, 56px);
  border: 1px solid var(--viz-baseline);
}

.column {
  width: min(720px, 100%);
  margin: 0 auto;
  align-self: center;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.meta {
  font-size: 11px;
  overflow-wrap: anywhere;
  color: var(--viz-muted);
}

.headline {
  margin: 12px 0 18px;
  font-size: clamp(1.35rem, 4vw, 2rem);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--viz-ink);
}

.aside {
  margin-top: 10px;
  color: var(--viz-muted);
}

.confirm {
  margin-top: 30px;
  border-top: 1px solid var(--viz-grid);
  padding-top: 18px;
}

.warning {
  margin-bottom: 14px;
  color: var(--viz-ink);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.column > .row {
  margin-top: 30px;
}

.button {
  padding: 9px 18px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.button:hover {
  background: var(--viz-ink);
  color: var(--viz-surface);
}

.button--quiet {
  border-color: var(--viz-baseline);
  color: var(--viz-ink-secondary);
}

.footnote {
  margin: 0;
  font-size: 13px;
  color: var(--viz-muted);
}
</style>

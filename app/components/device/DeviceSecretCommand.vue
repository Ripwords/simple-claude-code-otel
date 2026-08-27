<script setup lang="ts">
interface Props {
  command: string
  token: string
}

const props = defineProps<Props>()

const emit = defineEmits<{ copied: [what: 'command' | 'token'] }>()

/**
 * The inverted button is the operator's own record of what they did on a screen
 * that exists to answer "did I copy it", so it must not time itself out.
 */
const KEEP = 86_400_000

const { state: commandState, copy: copyText } = useCopy(KEEP)
const { state: tokenState, copy: copyTokenText } = useCopy(KEEP)

const node = ref<HTMLElement | null>(null)
const tokenNode = ref<HTMLElement | null>(null)
const primary = ref<HTMLButtonElement | null>(null)

const tail = computed(() => props.command.endsWith(props.token) ? props.token : '')
const head = computed(() => tail.value ? props.command.slice(0, -tail.value.length) : props.command)

const manual = computed(() => commandState.value === 'manual' || tokenState.value === 'manual')
const shortcut = computed(() => isApplePlatform() ? '⌘C' : 'Ctrl+C')

function isApplePlatform(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  if (data?.platform) return data.platform === 'macOS'
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

async function copyCommand() {
  await copyText(props.command, node.value)
  if (commandState.value === 'copied') emit('copied', 'command')
}

async function copyToken() {
  await copyTokenText(props.token, tokenNode.value)
  if (tokenState.value === 'copied') emit('copied', 'token')
}

function focusPrimary() {
  primary.value?.focus()
}

defineExpose({ focusPrimary, copyCommand })
</script>

<template>
  <div class="block">
    <div class="rule">
      <code
        ref="node"
        class="command viz-mono"
      >{{ head }}<span
        ref="tokenNode"
        class="token"
      >{{ tail }}</span></code>
    </div>

    <div class="row">
      <button
        ref="primary"
        type="button"
        class="copy viz-mono viz-focus"
        :class="{ 'copy--done': commandState === 'copied' }"
        @click="copyCommand"
      >
        {{ commandState === 'copied' ? 'Copied' : 'Copy command' }}
      </button>

      <button
        type="button"
        class="copy copy--quiet viz-mono viz-focus"
        :class="{ 'copy--done': tokenState === 'copied' }"
        @click="copyToken"
      >
        {{ tokenState === 'copied' ? 'Copied' : 'Copy token only' }}
      </button>
    </div>

    <p
      v-if="manual"
      class="manual viz-prose"
      role="alert"
    >
      Copy failed. The text is selected. Press {{ shortcut }}.
    </p>
  </div>
</template>

<style scoped>
.rule {
  border-top: 2px solid var(--viz-ink);
  border-bottom: 1px solid var(--viz-grid);
  padding: 44px 0;
  margin: 32px 0 24px;
}

.command {
  display: block;
  font-size: clamp(12.5px, 3.2vw, 15px);
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: all;
  color: var(--viz-ink-secondary);
}

.token {
  font-weight: 600;
  color: var(--viz-ink);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.copy {
  padding: 9px 18px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

@media (prefers-reduced-motion: no-preference) {
  .copy {
    transition: background-color 120ms linear, color 120ms linear;
  }
}

.copy--quiet {
  border-color: var(--viz-baseline);
  color: var(--viz-ink-secondary);
}

.copy--done {
  border-color: var(--viz-ink);
  background: var(--viz-ink);
  color: var(--viz-surface);
}

.manual {
  margin-top: 14px;
  color: var(--viz-status-serious);
}
</style>

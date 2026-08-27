<script setup lang="ts">
import type { DeviceCascade, DeviceInfo, DeviceSecret } from '#shared/types'
import type { DeviceAction, PanelResult, SecretReason } from '~/utils/deviceStatus'

useSeoMeta({ title: 'Machines · Claude Code Telemetry' })

const { data, pending, error, unavailable, create, rename, rotate, revoke, release, destroy } = useDevices()

const devices = computed(() => sortDevices(data.value ?? []))
const otlpEndpoint = `${useRequestURL().origin}/api/otlp`

/**
 * One union rather than a set of booleans: exactly one thing is on screen, and the
 * secret overlay cannot coexist with the row panel that minted it.
 */
type Pane
  = | { kind: 'idle' }
    | { kind: 'row', action: DeviceAction, device: DeviceInfo }
    | { kind: 'secret', secret: DeviceSecret, reason: SecretReason }
    | { kind: 'destroyed', name: string, counts: DeviceCascade }

const pane = ref<Pane>({ kind: 'idle' })
const busy = ref(false)
const failure = ref<string | null>(null)

const newName = ref('')
const adding = ref(false)
const addFailure = ref<string | null>(null)

// A 404 here is ambiguous in a way the generic message cannot be: the route may
// not be deployed yet, or the machine may genuinely be gone.
const RELEASE_MISSING = 'The release route answered 404. Either this deployment does not have it yet, or this machine is already gone. Reload the page to tell which.'

const rowPane = computed(() => pane.value.kind === 'row' ? { action: pane.value.action, device: pane.value.device } : null)
const secretPane = computed(() => pane.value.kind === 'secret' ? pane.value : null)
const destroyed = computed(() => pane.value.kind === 'destroyed' ? pane.value : null)
const loadFailure = computed(() => error.value ? describeFailure(error.value, 'read the machine list') : null)

async function add() {
  const problem = nameProblem(newName.value, devices.value)
  if (problem) {
    addFailure.value = problem
    return
  }

  adding.value = true
  addFailure.value = null
  try {
    const secret = await create(newName.value.trim())
    newName.value = ''
    pane.value = { kind: 'secret', secret, reason: 'minted' }
  } catch (err) {
    addFailure.value = describeFailure(err, 'add the machine')
  } finally {
    adding.value = false
  }
}

function act(action: DeviceAction, device: DeviceInfo) {
  failure.value = null
  const open = rowPane.value
  pane.value = open && open.action === action && open.device.id === device.id
    ? { kind: 'idle' }
    : { kind: 'row', action, device }
}

async function confirm(result: PanelResult) {
  const open = rowPane.value
  if (!open) return

  const device = open.device
  if (result.action === 'rename') {
    const problem = nameProblem(result.name, devices.value, device.id)
    if (problem) {
      failure.value = problem
      return
    }
  }

  busy.value = true
  failure.value = null
  try {
    if (result.action === 'rename') {
      await rename(device.id, result.name.trim())
      pane.value = { kind: 'idle' }
    } else if (result.action === 'rotate') {
      const secret = await rotate(device.id)
      pane.value = { kind: 'secret', secret, reason: 'rotated' }
    } else if (result.action === 'revoke') {
      await revoke(device.id)
      pane.value = { kind: 'idle' }
    } else if (result.action === 'release') {
      await release(device.id)
      pane.value = { kind: 'idle' }
    } else {
      const counts = await destroy(device.id)
      pane.value = { kind: 'destroyed', name: device.name, counts }
    }
  } catch (err) {
    failure.value = result.action === 'release' && statusOf(err) === 404
      ? RELEASE_MISSING
      : describeFailure(err, `${result.action} the machine`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1 class="title">
        Machines
      </h1>
      <p class="viz-prose">
        Every machine allowed to report here, and the token that lets it. A token is readable once,
        at the moment you mint it, and never again.
      </p>
    </header>

    <section
      v-if="unavailable"
      class="notice"
    >
      <p class="viz-eyebrow">
        Devices API not answering
      </p>
      <h2 class="notice-headline">
        This deployment has no machine roster
      </h2>
      <p class="viz-prose">
        <span class="viz-code">GET /api/devices</span> answered 404, so there is nothing here to read
        and nothing to change. This is not an empty list. Deploy the device routes and reload.
      </p>
    </section>

    <template v-else>
      <p
        v-if="loadFailure"
        class="failure"
        role="alert"
      >
        {{ loadFailure }}
      </p>

      <DeviceAddForm
        v-model="newName"
        :busy="adding"
        :failure="addFailure"
        @submit="add"
      />

      <section
        v-if="destroyed"
        class="destroyed"
      >
        <p class="viz-eyebrow">
          Deleted
        </p>
        <h2 class="notice-headline">
          <span class="viz-mono">{{ destroyed.name }}</span> and its history are gone
        </h2>
        <p class="viz-prose">
          The cascade destroyed these rows with it. None of it can be recovered.
        </p>

        <dl class="counts">
          <div
            v-for="[key, value] in Object.entries(destroyed.counts)"
            :key="key"
            class="count"
          >
            <dt class="viz-eyebrow">
              {{ humaniseCount(key) }}
            </dt>
            <dd class="viz-mono viz-tabular">
              {{ formatCount(value) }}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          class="dismiss viz-mono viz-focus"
          @click="pane = { kind: 'idle' }"
        >
          Dismiss
        </button>
      </section>

      <p
        v-if="pending && devices.length === 0"
        class="viz-no-data viz-mono"
      >
        Reading the roster…
      </p>

      <section
        v-else-if="devices.length === 0"
        class="empty"
      >
        <p class="viz-eyebrow">
          No machines yet
        </p>
        <h2 class="notice-headline">
          Nothing can report here until you add one
        </h2>
        <p class="viz-prose">
          Name a machine above and the dashboard mints its token. Run the command it shows you on
          that machine, and it starts appearing in every chart.
        </p>
      </section>

      <DeviceRoster
        v-else
        :devices="devices"
        :otlp-endpoint="otlpEndpoint"
        :pane="rowPane"
        :busy="busy"
        :failure="failure"
        @act="act"
        @confirm="confirm"
        @cancel="pane = { kind: 'idle' }"
      />
    </template>

    <DeviceSecretOverlay
      v-if="secretPane"
      :secret="secretPane.secret"
      :reason="secretPane.reason"
      :otlp-endpoint="otlpEndpoint"
      @dismiss="pane = { kind: 'idle' }"
    />
  </div>
</template>

<style scoped>
.page {
  padding-bottom: 40px;
}

.header {
  padding: 8px 0 24px;
}

.title {
  margin: 0 0 10px;
  font-size: clamp(1.35rem, 4vw, 2rem);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.015em;
  color: var(--viz-ink);
}

.notice,
.empty,
.destroyed {
  padding: 22px 0 24px;
  border-top: 1px solid var(--viz-grid);
  max-width: 72ch;
}

.destroyed {
  border-top: 2px solid var(--viz-ink);
}

.notice-headline {
  margin: 10px 0 12px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--viz-ink);
}

.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  margin: 18px 0 0;
}

.counts dd {
  margin: 4px 0 0;
  font-size: 15px;
  color: var(--viz-ink);
}

.dismiss {
  margin-top: 20px;
  padding: 7px 16px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.failure {
  margin: 16px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--viz-status-critical);
}
</style>

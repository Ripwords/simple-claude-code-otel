<script setup lang="ts">
const STORAGE_KEY = 'cct:announced-devices'
const RECENT_MS = 86_400_000

interface Arrival {
  id: string
  name: string
  firstSeen: string
  sessions: number
}

const { data: devices } = useDevices()
const { colorFor } = useDeviceColors()

// There is no server-side acknowledged flag, so "announced once" lives here. It
// is read after mount only, so the server and client renders agree.
const announced = ref<string[]>([])
const ready = ref(false)

function readAnnounced(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeAnnounced(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Private mode and a blocked store both throw. The notice still goes away
    // for this page view, it just comes back on the next load.
  }
}

onMounted(() => {
  announced.value = readAnnounced()
  ready.value = true
})

const arrivals = computed<Arrival[]>(() => {
  if (!ready.value) return []
  const now = Date.now()

  return (devices.value ?? []).flatMap<Arrival>((device) => {
    if (device.status !== 'reporting' || device.firstSeen === null) return []
    if (now - Date.parse(device.firstSeen) >= RECENT_MS) return []
    if (announced.value.includes(device.id)) return []
    return [{ id: device.id, name: device.name, firstSeen: device.firstSeen, sessions: device.sessions }]
  })
})

const waiting = computed(() => (devices.value ?? []).filter(device => device.status === 'pending'))

function dismiss(id: string) {
  const next = [...announced.value, id]
  announced.value = next
  writeAnnounced(next)
}
</script>

<template>
  <div
    v-if="arrivals.length > 0 || waiting.length > 0"
    class="notices"
  >
    <section
      v-for="device in arrivals"
      :key="`reporting-${device.id}`"
      class="notice"
    >
      <p class="viz-eyebrow">
        Setup confirmed
      </p>

      <h2 class="headline">
        <span
          class="dot"
          :style="{ backgroundColor: colorFor(device.id) }"
        />
        <span class="viz-mono">{{ device.name }}</span>
        <span class="headline-rest">has started reporting</span>
      </h2>

      <p class="viz-prose">
        Its first telemetry arrived <span class="viz-mono">{{ formatStamp(device.firstSeen) }}</span>,
        {{ device.sessions }} {{ device.sessions === 1 ? 'session' : 'sessions' }} so far. Setup
        worked, and its numbers are already in every view below.
      </p>

      <button
        type="button"
        class="action viz-mono viz-focus"
        @click="dismiss(device.id)"
      >
        Got it
      </button>
    </section>

    <section
      v-for="device in waiting"
      :key="`pending-${device.id}`"
      class="notice notice-fix"
    >
      <p class="viz-eyebrow">
        Waiting on setup
      </p>

      <h2 class="headline">
        <span class="viz-mono">{{ device.name }}</span>
        <span class="headline-rest">has not reported yet</span>
      </h2>

      <p class="viz-prose">
        You added it <span class="viz-mono">{{ formatStamp(device.createdAt) }}</span> and nothing
        has arrived from it since. Until it reports it has no numbers anywhere on this page.
      </p>

      <NuxtLink
        to="/devices"
        class="action viz-mono viz-focus"
      >
        Finish setting it up
      </NuxtLink>
    </section>
  </div>
</template>

<style scoped>
.notices {
  display: grid;
  gap: 1px;
  background: var(--viz-grid);
  border: 1px solid var(--viz-grid);
}

.notice {
  background: var(--viz-page);
  padding: 20px 22px;
}

.notice-fix {
  border-left: 3px solid var(--viz-status-warning);
}

.headline {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 6px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--viz-ink);
}

.headline-rest {
  font-weight: 500;
  color: var(--viz-ink-secondary);
}

.dot {
  width: 9px;
  height: 9px;
  flex: none;
  align-self: center;
}

.action {
  display: inline-block;
  margin-top: 14px;
  padding: 6px 14px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.action:hover {
  background: var(--viz-ink);
  color: var(--viz-surface);
}
</style>

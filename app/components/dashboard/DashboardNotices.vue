<script setup lang="ts">
const STORAGE_KEY = 'cct:announced-devices'
const RECENT_MS = 86_400_000
const VISIBLE = 3

type Kind = 'refused' | 'waiting' | 'new'

interface Item {
  id: string
  kind: Kind
  name: string
  /** The detail the old notice spelled out, kept for assistive tech and the hover title. */
  detail: string
}

const { data: devices } = useDevices()

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
    // Private mode and a blocked store both throw. The item still goes away for
    // this page view, it just comes back on the next load.
  }
}

onMounted(() => {
  announced.value = readAnnounced()
  ready.value = true
})

// Ordered by how much each one matters: a refusal is a live hole in the data and
// cannot be dismissed, a machine waiting on setup is a chore, an arrival is news.
const items = computed<Item[]>(() => {
  const all = devices.value ?? []
  const now = Date.now()

  const refused = all.flatMap<Item>(device => device.conflict === null
    ? []
    : [{
        id: device.id,
        kind: 'refused',
        name: device.name,
        detail: `Another Claude Code account was refused ${device.conflict.count === 1 ? 'once' : `${formatCount(device.conflict.count)} times`}, last ${formatStamp(device.conflict.at)}. Nothing it did since is counted.`
      }])

  const waiting = all.flatMap<Item>(device => device.status !== 'pending'
    ? []
    : [{ id: device.id, kind: 'waiting', name: device.name, detail: `Added ${formatStamp(device.createdAt)}; nothing has arrived from it yet.` }])

  const arrived = !ready.value
    ? []
    : all.flatMap<Item>((device) => {
        if (device.status !== 'reporting' || device.firstSeen === null) return []
        if (now - Date.parse(device.firstSeen) >= RECENT_MS) return []
        if (announced.value.includes(device.id)) return []
        return [{ id: device.id, kind: 'new', name: device.name, detail: `First telemetry ${formatStamp(device.firstSeen)}. Setup worked.` }]
      })

  return [...refused, ...waiting, ...arrived]
})

const shown = computed(() => items.value.slice(0, VISIBLE))
const hidden = computed(() => items.value.length - shown.value.length)

const VERB: Record<Kind, string> = { refused: 'refused', waiting: 'not set up', new: 'new' }

function dismiss(id: string) {
  const next = [...announced.value, id]
  announced.value = next
  writeAnnounced(next)
}
</script>

<template>
  <ul
    v-if="items.length > 0"
    class="status"
    aria-label="Machine status"
  >
    <li
      v-for="item in shown"
      :key="`${item.kind}-${item.id}`"
      class="item"
      :class="`is-${item.kind}`"
      :title="item.detail"
    >
      <span
        class="mark"
        aria-hidden="true"
      />
      <NuxtLink
        to="/devices"
        class="name viz-mono viz-focus"
      >
        {{ item.name }}
      </NuxtLink>
      <span class="verb">{{ VERB[item.kind] }}</span>
      <span class="sr-only">. {{ item.detail }}</span>
      <button
        v-if="item.kind === 'new'"
        type="button"
        class="dismiss viz-focus"
        :aria-label="`Dismiss: ${item.name} started reporting`"
        @click="dismiss(item.id)"
      >
        <UIcon
          name="i-lucide-x"
          aria-hidden="true"
        />
      </button>
    </li>

    <li
      v-if="hidden > 0"
      class="item"
    >
      <NuxtLink
        to="/devices"
        class="more viz-focus"
      >
        +{{ hidden }} more
      </NuxtLink>
    </li>
  </ul>
</template>

<style scoped>
.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3xs) var(--space-sm);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--viz-ink-secondary);
}

.item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
  white-space: nowrap;
}

.mark {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
}

/* Shape carries the meaning as well as colour: refused is solid, waiting is hollow. */
.is-refused .mark {
  background: var(--viz-status-critical);
}

.is-waiting .mark {
  box-shadow: inset 0 0 0 1.5px var(--viz-status-warning);
}

.is-new .mark {
  background: var(--viz-status-good);
}

.is-refused .verb {
  color: var(--viz-status-critical);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 16ch;
  color: var(--viz-ink);
  text-decoration: underline;
  text-decoration-color: var(--viz-grid);
  text-underline-offset: 3px;
  transition: text-decoration-color var(--dur-short) var(--ease-out);
}

.name:hover {
  text-decoration-color: currentcolor;
}

.dismiss {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-left: calc(var(--space-3xs) * -1);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--viz-muted);
  cursor: pointer;
}

.dismiss:hover {
  color: var(--viz-ink);
  background: var(--viz-page);
}

.dismiss:active {
  transform: translateY(1px);
}

.more {
  color: var(--viz-ink-secondary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .name {
    transition: none;
  }
}
</style>

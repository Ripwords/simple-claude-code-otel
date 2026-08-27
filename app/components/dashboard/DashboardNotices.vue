<script setup lang="ts">
const { arrivals, unlabelled, acknowledge, pendingDevice, failures } = useDeviceOnboarding()
const { colorFor } = useDeviceColors()
</script>

<template>
  <div
    v-if="arrivals.length > 0 || unlabelled.length > 0"
    class="notices"
  >
    <section
      v-for="device in arrivals"
      :key="`new-${device.device}`"
      class="notice"
    >
      <p class="viz-eyebrow">
        New machine
      </p>

      <h2 class="headline">
        <span
          class="dot"
          :style="{ backgroundColor: colorFor(device.device) }"
        />
        <span class="viz-mono">{{ device.device }}</span>
        <span class="headline-rest">started reporting</span>
      </h2>

      <p class="viz-prose">
        First seen <span class="viz-mono">{{ formatStamp(device.firstSeen) }}</span>,
        {{ device.sessions }} {{ device.sessions === 1 ? 'session' : 'sessions' }} so far.
        Its numbers are already in every view below.
      </p>

      <div class="actions">
        <button
          type="button"
          class="action viz-mono viz-focus"
          :disabled="pendingDevice === device.device"
          @click="acknowledge(device.device)"
        >
          {{ pendingDevice === device.device ? 'Saving…' : 'Got it' }}
        </button>

        <p
          v-if="failures[device.device]"
          class="failure"
        >
          {{ failures[device.device] }}
        </p>
      </div>
    </section>

    <section
      v-for="device in unlabelled"
      :key="`unlabelled-${device.device}`"
      class="notice notice-fix"
    >
      <p class="viz-eyebrow">
        Unlabelled telemetry
      </p>

      <h2 class="headline">
        <span class="headline-rest">Telemetry arrived with no device name</span>
      </h2>

      <p class="viz-prose">
        It is filed under <span class="viz-code">{{ device.device }}</span>, and every machine
        that reports without a name lands in that same row. While this stands you cannot tell
        those machines apart anywhere on this page.
      </p>

      <p class="viz-prose">
        On the machine that sent it, run
        <span class="viz-code">scripts/setup-device.sh --device &lt;name&gt;</span>
        and restart Claude Code. The row clears once named telemetry arrives.
      </p>
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

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.action {
  padding: 6px 14px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.action:hover:not(:disabled) {
  background: var(--viz-ink);
  color: var(--viz-surface);
}

.action:disabled {
  cursor: progress;
  color: var(--viz-muted);
  border-color: var(--viz-grid);
}

.failure {
  font-size: 13px;
  line-height: 1.5;
  color: var(--viz-status-critical);
}
</style>

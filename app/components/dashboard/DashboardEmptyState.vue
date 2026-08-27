<script setup lang="ts">
interface Props {
  pending: boolean
}

defineProps<Props>()
</script>

<template>
  <UCard>
    <div
      v-if="pending"
      class="flex items-center gap-3"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      />
      <span :style="{ color: 'var(--viz-ink-secondary)' }">Looking for telemetry...</span>
    </div>

    <div
      v-else
      class="max-w-2xl space-y-4"
    >
      <h2
        class="text-lg font-semibold"
        :style="{ color: 'var(--viz-ink)' }"
      >
        No telemetry yet
      </h2>

      <p :style="{ color: 'var(--viz-ink-secondary)' }">
        Nothing has been sent to this dashboard so far. Claude Code does not report anything
        until you point it here, and you have to do that once on every machine you use.
      </p>

      <p :style="{ color: 'var(--viz-ink-secondary)' }">
        On each machine, open <code>~/.claude/settings.json</code> and add an <code>env</code> block
        with this dashboard's endpoint, your ingest token, and
        <code>OTEL_RESOURCE_ATTRIBUTES=device.name=...</code>. Give every machine a different
        name there, because that name is what tells your laptops apart on every screen here.
      </p>

      <p :style="{ color: 'var(--viz-ink-secondary)' }">
        The exact block to copy is in README.md in the repo root. Once one machine has sent
        anything, this page fills in on its own.
      </p>
    </div>
  </UCard>
</template>

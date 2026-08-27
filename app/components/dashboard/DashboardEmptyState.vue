<script setup lang="ts">
interface Props {
  pending: boolean
}

defineProps<Props>()
</script>

<template>
  <div
    v-if="pending"
    class="waiting viz-mono"
  >
    Looking for telemetry…
  </div>

  <div
    v-else
    class="empty"
  >
    <p class="viz-eyebrow">
      Nothing reporting yet
    </p>

    <h2 class="headline">
      Point a machine at this dashboard and it appears here
    </h2>

    <ol class="steps">
      <li class="viz-prose">
        On the machine you want to track, run
        <span class="viz-code">scripts/setup-device.sh --device &lt;name&gt;</span>.
        The name is what tells your machines apart on every screen here, so give each one
        its own.
      </li>
      <li class="viz-prose">
        Start Claude Code and work for a minute. Telemetry is batched, so the first numbers
        take a moment.
      </li>
      <li class="viz-prose">
        Repeat on your second machine. Two machines is when this page earns its keep: it is
        built to show you the gap between them.
      </li>
    </ol>

    <p class="viz-prose">
      The setup script writes <span class="viz-code">~/.claude/settings.json</span>. The exact
      block it writes, and how to write it by hand, is in <span class="viz-code">README.md</span>.
    </p>
  </div>
</template>

<style scoped>
.waiting {
  padding: 40px 0;
  font-size: 13px;
  color: var(--viz-muted);
}

.empty {
  padding: 28px 0 8px;
  max-width: 62ch;
}

.headline {
  margin: 10px 0 22px;
  font-size: clamp(1.25rem, 3.4vw, 1.75rem);
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: var(--viz-ink);
}

.steps {
  margin: 0 0 22px;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.steps li {
  position: relative;
  counter-increment: step;
  padding: 14px 0 14px 34px;
  border-top: 1px solid var(--viz-grid);
}

.steps li::before {
  content: counter(step, decimal-leading-zero);
  position: absolute;
  left: 0;
  top: 15px;
  font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--viz-muted);
}
</style>

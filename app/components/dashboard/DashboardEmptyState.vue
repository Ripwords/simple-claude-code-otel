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
    Looking for machines…
  </div>

  <div
    v-else
    class="empty"
  >
    <p class="viz-eyebrow">
      No machines yet
    </p>

    <h2 class="headline">
      Add a machine here, then point it at this dashboard
    </h2>

    <ol class="steps">
      <li class="viz-prose">
        <p class="step-text">
          Add your first machine. Give it a name you will recognise, because that name is what
          tells your machines apart on every screen here.
        </p>
        <NuxtLink
          to="/devices"
          class="primary viz-mono viz-focus"
        >
          Add a machine
        </NuxtLink>
      </li>
      <li class="viz-prose">
        The dashboard hands you a token and the exact command to run on that machine. The token
        is shown once and never again, so run the command before you close it.
      </li>
      <li class="viz-prose">
        Start Claude Code on that machine and work for a minute. Telemetry is batched, so the
        first numbers take a moment to land.
      </li>
      <li class="viz-prose">
        Repeat on a second machine. Two is when the comparison earns its keep: this page is
        built to show you the gap between them.
      </li>
    </ol>
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

.step-text {
  margin: 0;
}

.primary {
  display: inline-block;
  margin-top: 14px;
  padding: 8px 18px;
  border: 1px solid var(--viz-ink);
  background: var(--viz-ink);
  color: var(--viz-surface);
  font-size: 12px;
  letter-spacing: 0.06em;
}

.primary:hover {
  background: transparent;
  color: var(--viz-ink);
}
</style>

<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'Claude Code Telemetry'
const description = 'Read the gap between your machines: what each one did with Claude Code, and what it cost.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description
})
</script>

<template>
  <UApp>
    <div class="viz-root shell">
      <div class="panel">
        <header class="topbar">
          <NuxtLink
            to="/"
            class="wordmark viz-mono viz-focus"
          >
            claude-code<span class="wordmark-dim">/</span>telemetry
          </NuxtLink>

          <UColorModeButton />
        </header>

        <main>
          <NuxtPage />
        </main>
      </div>
    </div>
  </UApp>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
  background: var(--viz-page);
  padding: 0 max(16px, env(safe-area-inset-left));
}

.panel {
  max-width: 1140px;
  margin: 0 auto;
  min-width: 0;
  min-height: 100dvh;
  background: var(--viz-surface);
  border-inline: 1px solid var(--viz-grid);
  padding: 0 clamp(16px, 4vw, 44px) 72px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 0 20px;
}

.wordmark {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--viz-ink);
}

.wordmark-dim {
  color: var(--viz-muted);
}
</style>

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

const route = useRoute()
const { signOut } = useAuth()

const NAV = [
  { to: '/', label: 'dashboard' },
  { to: '/devices', label: 'machines' }
]

const gated = computed(() => route.path === '/login')
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

          <nav
            v-if="!gated"
            class="nav"
            aria-label="Sections"
          >
            <NuxtLink
              v-for="link in NAV"
              :key="link.to"
              :to="link.to"
              class="nav-link viz-mono viz-focus"
              :class="{ 'is-active': route.path === link.to }"
              :aria-current="route.path === link.to ? 'page' : undefined"
            >
              {{ link.label }}
            </NuxtLink>
          </nav>

          <div class="controls">
            <button
              v-if="!gated"
              type="button"
              class="signout viz-mono viz-focus"
              @click="signOut()"
            >
              sign out
            </button>

            <UColorModeButton />
          </div>
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
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
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

/* Full-width on its own row until there is room beside the wordmark, so the
   topbar never overflows on a narrow phone. */
.nav {
  order: 3;
  flex-basis: 100%;
  display: flex;
  gap: 2px;
  margin-left: -10px;
}

.nav-link {
  padding: 5px 10px;
  border-bottom: 2px solid transparent;
  color: var(--viz-muted);
  font-size: 12px;
}

.nav-link:hover {
  color: var(--viz-ink);
}

.nav-link.is-active {
  color: var(--viz-ink);
  border-bottom-color: var(--viz-ink);
}

.controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.signout {
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: var(--viz-muted);
  font-size: 12px;
  cursor: pointer;
}

.signout:hover {
  color: var(--viz-ink);
}

@media (width >= 620px) {
  .nav {
    order: 0;
    flex-basis: auto;
    margin-left: 12px;
  }
}
</style>

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
const description = 'Compare Claude Code usage, cost, and tool activity across your machines.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description
})
</script>

<template>
  <UApp>
    <div class="viz-root">
      <UHeader>
        <template #left>
          <NuxtLink
            to="/"
            class="focus-visible:outline-3 outline-primary/25 rounded-md p-1 -ms-1 font-semibold"
          >
            Claude Code Telemetry
          </NuxtLink>
        </template>

        <template #right>
          <UColorModeButton />
        </template>
      </UHeader>

      <UMain>
        <NuxtPage />
      </UMain>

      <USeparator />

      <UFooter>
        <template #left>
          <p class="text-sm text-muted">
            Claude Code Telemetry • © {{ new Date().getFullYear() }}
          </p>
        </template>
      </UFooter>
    </div>
  </UApp>
</template>

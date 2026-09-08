import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Nuxt resolves #shared itself at build time. Vitest runs these units outside Nuxt, so
// without this alias any server util that imports shared types is untestable.
export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  }
})

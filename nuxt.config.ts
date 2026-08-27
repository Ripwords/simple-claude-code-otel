export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || '',
    cronSecret: process.env.CRON_SECRET || '',
    dashboardPasswordHash: process.env.DASHBOARD_PASSWORD_HASH || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    retentionDays: process.env.RETENTION_DAYS || '90',
    public: {
      appName: 'Claude Code Telemetry'
    }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    preset: 'vercel',
    vercel: {
      // Singapore, because the Neon database is in ap-southeast-1. Every dashboard
      // query is a round trip to it, so colocating the functions is the difference
      // between one hop and a Pacific crossing per query.
      functions: { regions: ['sin1'] },
      config: {
        crons: [{ path: '/api/cron/prune', schedule: '0 4 * * *' }]
      }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})

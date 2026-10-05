export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  app: {
    head: {
      link: [
        // The SVG carries its own prefers-color-scheme swap, so it inverts with the
        // browser chrome. The .ico is the light-only fallback for anything that
        // cannot render it.
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' }
      ]
    }
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || '',
    cronSecret: process.env.CRON_SECRET || '',
    // Optional. When set, ingest is buffered here so Neon can sleep between flushes.
    redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
    dashboardPasswordHash: process.env.DASHBOARD_PASSWORD_HASH || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    // Raw rows are kept only long enough to serve hourly charts and absorb a laptop that
    // was offline; everything older is answered from the daily rollups.
    rawRetentionDays: process.env.RAW_RETENTION_DAYS || '7',
    rollupRetentionDays: process.env.ROLLUP_RETENTION_DAYS || '400',
    sizeAlarmBytes: process.env.DB_SIZE_ALARM_BYTES || String(400 * 1024 * 1024),
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

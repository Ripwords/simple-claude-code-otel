import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

let client: NeonQueryFunction<false, false> | null = null

export function db() {
  if (!client) {
    const url = useRuntimeConfig().databaseUrl
    if (!url) throw createError({ statusCode: 500, statusMessage: 'DATABASE_URL is not configured' })
    client = neon(url)
  }
  return client
}

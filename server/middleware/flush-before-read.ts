import { flush } from '../utils/buffer'
import { hasSession } from '../utils/session'

// The dashboard reads Postgres, so whatever is still parked in Redis would be missing from it.
// Opening the dashboard wakes the database anyway, so draining the queue first costs nothing
// extra and means a signed-in reader never sees numbers up to half an hour stale.
const READS = /^\/api\/(stats\/|devices$)/

// A page load fires a dozen stats requests at once. Those landing on the same instance share
// one flush; the rest wait on the Redis lock inside flush().
let running: Promise<unknown> | null = null

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' || !READS.test(event.path.split('?')[0] ?? '')) return
  // Unauthenticated requests are refused by the route itself; they must not wake the database first.
  if (!hasSession(event, String(useRuntimeConfig(event).sessionSecret ?? ''))) return

  running ??= flush({ wait: true })
    .catch(error => console.error('[flush-before-read] serving what Postgres has; the queue is kept', error))
    .finally(() => {
      running = null
    })
  await running
})

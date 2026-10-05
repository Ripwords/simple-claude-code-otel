import type { AuthenticatedDevice } from './deviceToken'
import { redis } from './buffer'

/**
 * Token lookups are answered from Redis so a buffered ingest request never touches Postgres;
 * one query per request would keep the database awake as surely as writing would. Anything
 * that changes what a token means must call forgetDevice with the hash it had, or the old
 * answer outlives the change by up to the TTL -- a revoked token would keep reporting.
 */

type CachedDevice = Omit<AuthenticatedDevice, 'tokenHash'>

const DEVICE_TTL_SECONDS = 60 * 60
// An unknown token is cached too, so a stream of bad tokens cannot wake the database per
// request. Kept short: a freshly minted token is a hash nobody could have looked up before.
const MISSING_TTL_SECONDS = 10 * 60
const MISSING = 'none'
// Written in place of the entry when a device changes, rather than deleting it. A request that
// read the device just before the change would otherwise write its stale answer back after the
// delete, and a revoked token would keep working for the full TTL. Fills use NX, so they cannot
// replace this marker; while it stands every request reads Postgres. It only has to outlive one
// in-flight lookup.
const STALE = 'stale'
const STALE_TTL_SECONDS = 60

const key = (tokenHash: string) => `device:${tokenHash}`

// A second layer in the instance's own memory. Every machine posts at least once a minute and
// Vercel's Fluid compute keeps a warm instance serving many requests, so most lookups never
// reach Redis -- which halves the commands an ingest request costs against Upstash's monthly
// quota. The price is that a revoke or rotate made on another instance takes up to this long to
// reach this one; on the instance that made it, the entry is dropped at once.
const LOCAL_TTL_MS = 30_000
const LOCAL_MAX = 1000
const local = new Map<string, { device: CachedDevice | null, expires: number }>()

function remember(tokenHash: string, device: CachedDevice | null) {
  if (local.size >= LOCAL_MAX) local.clear()
  local.set(tokenHash, { device, expires: Date.now() + LOCAL_TTL_MS })
}

export async function cachedDevice(
  tokenHash: string,
  load: () => Promise<CachedDevice | null>
): Promise<CachedDevice | null> {
  const store = redis()
  if (!store) return await load()

  const known = local.get(tokenHash)
  if (known && known.expires > Date.now()) return known.device

  let hit: string | null
  try {
    hit = await store.get<string>(key(tokenHash))
  } catch (error) {
    // Redis down or over quota: Postgres still knows the answer, so the request goes on.
    console.error('[device-cache] Redis unavailable, reading the device from Postgres', error)
    return await load()
  }
  // A device mid-change is never held locally, so the change reaches this instance next request.
  if (hit === STALE) return await load()
  if (hit === MISSING) {
    remember(tokenHash, null)
    return null
  }
  if (hit) {
    const device = JSON.parse(hit) as CachedDevice
    remember(tokenHash, device)
    return device
  }

  const device = await load()
  try {
    await store.set(key(tokenHash), device ? JSON.stringify(device) : MISSING, {
      nx: true,
      ex: device ? DEVICE_TTL_SECONDS : MISSING_TTL_SECONDS
    })
    remember(tokenHash, device)
  } catch (error) {
    console.error('[device-cache] Redis unavailable, device not cached', error)
  }
  return device
}

// Compare-and-set, so the update lands only on the exact entry it was derived from. Anything
// else in the slot -- the stale marker after a revoke, a refreshed entry -- wins over it.
const SWAP = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
  return 1
end
return 0`

/** Rewrites a cached device without a round trip to Postgres. A no-op if the entry has moved on. */
export async function updateCachedDevice(tokenHash: string, previous: CachedDevice, next: CachedDevice): Promise<void> {
  // The local copy takes the new value but keeps its expiry, so an update can never stretch
  // how long this instance might go on trusting an entry another instance has since revoked.
  const known = local.get(tokenHash)
  if (known) known.device = next
  await redis()?.eval(SWAP, [key(tokenHash)], [JSON.stringify(previous), JSON.stringify(next)])
}

// Deliberately not caught: if Redis cannot take the stale marker, the old entry would outlive a
// revoke once Redis is back, so the revoke has to fail loudly and be retried.
export async function forgetDevice(tokenHash: string | null | undefined): Promise<void> {
  if (tokenHash) local.delete(tokenHash)
  const store = redis()
  if (store && tokenHash) await store.set(key(tokenHash), STALE, { ex: STALE_TTL_SECONDS })
}

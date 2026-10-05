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

const key = (tokenHash: string) => `device:${tokenHash}`

export async function cachedDevice(
  tokenHash: string,
  load: () => Promise<CachedDevice | null>
): Promise<CachedDevice | null> {
  const store = redis()
  if (!store) return await load()

  const hit = await store.get<string>(key(tokenHash))
  if (hit === MISSING) return null
  if (hit) return JSON.parse(hit) as CachedDevice

  const device = await load()
  await store.set(key(tokenHash), device ? JSON.stringify(device) : MISSING, {
    ex: device ? DEVICE_TTL_SECONDS : MISSING_TTL_SECONDS
  })
  return device
}

export async function forgetDevice(tokenHash: string | null | undefined): Promise<void> {
  const store = redis()
  if (store && tokenHash) await store.del(key(tokenHash))
}

import type { DeviceCascade, DeviceInfo, DeviceSecret } from '#shared/types'

export interface FetchFailure {
  statusCode?: number
  status?: number
  statusMessage?: string
  data?: { statusMessage?: string, message?: string }
}

export function statusOf(error: unknown): number | undefined {
  const failure = error as FetchFailure | null
  return failure?.statusCode ?? failure?.status
}

/**
 * The operator can only act on a failure they can name, so every message says
 * which call answered what. A bare "something went wrong" is not one of them.
 */
export function describeFailure(error: unknown, action: string): string {
  const code = statusOf(error)
  const detail = (error as FetchFailure | null)?.data?.statusMessage ?? (error as FetchFailure | null)?.statusMessage

  if (code === undefined) return `The request to ${action} never completed. Check your connection and try again.`
  if (code === 401) return 'Your session expired. Sign in again, then retry.'
  if (code === 404) return 'This dashboard no longer has that machine. Reload to refresh the list.'
  if (code === 409) return detail ?? 'A machine with that name already exists.'
  if (code === 400) return detail ?? 'The server rejected that input. Use 1 to 64 characters.'
  return `${action} answered ${code}${detail ? `: ${detail}` : ''}. Nothing changed.`
}

function count(payload: Record<string, unknown>, key: string): number {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Parsed at the boundary: a missing count reads as zero rather than as `undefined` on screen. */
function cascade(payload: unknown): DeviceCascade {
  const row = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  return { sessions: count(row, 'sessions'), metricPoints: count(row, 'metricPoints'), events: count(row, 'events') }
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Shaped like the real credential: 24 random bytes as hex, prefixed by its first 8 chars. */
function fixtureSecret(): { token: string, prefix: string } {
  const token = randomHex(48)
  return { token, prefix: token.slice(0, 8) }
}

export function useDevices() {
  const fixture = useFixtureMode()
  const unavailable = useState('devices:unavailable', () => false)
  // These routes require the dashboard session cookie. During SSR a bare $fetch sends
  // no cookies, so the server call 401s, useAsyncData stores the error, and the client
  // hydrates that failure instead of retrying: a populated dashboard renders its empty
  // state on every refresh. useRequestFetch forwards the incoming request's headers.
  const request = useRequestFetch()

  const query = useAsyncData<DeviceInfo[]>(
    'devices',
    async () => {
      if (fixture.value === 'empty') return []
      if (fixture.value === 'data') return fixtureDevices()

      try {
        const roster = await request<DeviceInfo[]>('/api/devices')
        unavailable.value = false
        return roster
      } catch (error) {
        // The devices API may not be deployed yet. The dashboard still reads.
        if (statusOf(error) === 404) {
          unavailable.value = true
          return []
        }
        throw error
      }
    },
    { default: () => [], watch: [fixture] }
  )

  const roster = query.data

  function replace(device: DeviceInfo) {
    roster.value = (roster.value ?? []).map(entry => entry.id === device.id ? device : entry)
  }

  async function create(name: string): Promise<DeviceSecret> {
    if (fixture.value !== 'off') {
      const { token, prefix } = fixtureSecret()
      const device: DeviceInfo = {
        id: crypto.randomUUID(),
        name,
        tokenPrefix: prefix,
        status: 'pending',
        createdAt: new Date().toISOString(),
        firstSeen: null,
        lastSeen: null,
        revokedAt: null,
        sessions: 0
      }
      roster.value = [...(roster.value ?? []), device]
      return { device, token }
    }

    const secret = await $fetch<DeviceSecret>('/api/devices', { method: 'POST', body: { name } })
    roster.value = [...(roster.value ?? []), secret.device]
    return secret
  }

  async function rename(id: string, name: string): Promise<DeviceInfo> {
    if (fixture.value !== 'off') {
      const current = (roster.value ?? []).find(entry => entry.id === id)!
      const updated = { ...current, name }
      replace(updated)
      return updated
    }

    const updated = await $fetch<DeviceInfo>(`/api/devices/${id}`, { method: 'PATCH', body: { name } })
    replace(updated)
    return updated
  }

  async function rotate(id: string): Promise<DeviceSecret> {
    if (fixture.value !== 'off') {
      const current = (roster.value ?? []).find(entry => entry.id === id)!
      const { token, prefix } = fixtureSecret()
      // Matches the server: issuing a fresh credential puts the machine back in service.
      const updated: DeviceInfo = { ...current, tokenPrefix: prefix, revokedAt: null, status: current.firstSeen ? 'reporting' : 'pending' }
      replace(updated)
      return { device: updated, token }
    }

    const secret = await $fetch<DeviceSecret>(`/api/devices/${id}/rotate`, { method: 'POST' })
    replace(secret.device)
    return secret
  }

  async function revoke(id: string): Promise<DeviceInfo> {
    if (fixture.value !== 'off') {
      const current = (roster.value ?? []).find(entry => entry.id === id)!
      const updated: DeviceInfo = { ...current, status: 'revoked', revokedAt: current.revokedAt ?? new Date().toISOString() }
      replace(updated)
      return updated
    }

    const updated = await $fetch<DeviceInfo>(`/api/devices/${id}/revoke`, { method: 'POST' })
    replace(updated)
    return updated
  }

  async function destroy(id: string): Promise<DeviceCascade> {
    if (fixture.value !== 'off') {
      const current = (roster.value ?? []).find(entry => entry.id === id)!
      roster.value = (roster.value ?? []).filter(entry => entry.id !== id)
      return { sessions: current.sessions, metricPoints: current.sessions * 46, events: current.sessions * 118 }
    }

    const result = await $fetch<unknown>(`/api/devices/${id}`, { method: 'DELETE' })
    roster.value = (roster.value ?? []).filter(entry => entry.id !== id)
    return cascade(result)
  }

  return { ...query, unavailable, create, rename, rotate, revoke, destroy }
}

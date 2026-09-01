import type { AllowedEmail } from '#shared/types'

/** Both sources at once, so a derived row and a removable one can be seen side by side. */
export function fixtureAllowlist(): AllowedEmail[] {
  return [
    { email: 'contractor@example.com', source: 'manual', addedAt: '2026-08-19T14:20:00.000Z' },
    { email: 'pair@example.com', source: 'manual', addedAt: '2026-08-26T11:05:00.000Z' },
    { email: 'you@example.com', source: 'device', addedAt: null }
  ]
}

export function useAllowlist() {
  const fixture = useFixtureMode()
  const unavailable = useState('allowlist:unavailable', () => false)
  // Behind the same dashboard session cookie as /api/devices. A bare $fetch carries no cookies
  // during SSR, so the read 401s, useAsyncData keeps that error, and the client hydrates the
  // failure rather than retrying: a populated list renders as an empty one on every refresh.
  // useRequestFetch forwards the incoming request's headers.
  const request = useRequestFetch()

  const query = useAsyncData<AllowedEmail[]>(
    'allowlist',
    async () => {
      if (fixture.value === 'empty') return []
      if (fixture.value === 'data') return fixtureAllowlist()

      try {
        const emails = await request<AllowedEmail[]>('/api/allowlist')
        unavailable.value = false
        return emails
      } catch (error) {
        // The allowlist routes may not be deployed yet. The rest of the page still works.
        if (statusOf(error) === 404) {
          unavailable.value = true
          return []
        }
        throw error
      }
    },
    { default: () => [], watch: [fixture] }
  )

  const emails = query.data

  /** The POST is idempotent, so an email already on the list is replaced rather than doubled. */
  function put(entry: AllowedEmail) {
    const rest = (emails.value ?? []).filter(existing => existing.email !== entry.email)
    emails.value = [...rest, entry].sort((a, b) => a.email.localeCompare(b.email))
  }

  async function add(email: string): Promise<AllowedEmail> {
    if (fixture.value !== 'off') {
      const existing = (emails.value ?? []).find(entry => entry.email === email)
      const entry: AllowedEmail = existing ?? { email, source: 'manual', addedAt: new Date().toISOString() }
      put(entry)
      return entry
    }

    const entry = await $fetch<AllowedEmail>('/api/allowlist', { method: 'POST', body: { email } })
    put(entry)
    return entry
  }

  async function remove(email: string): Promise<void> {
    if (fixture.value === 'off') {
      await $fetch(`/api/allowlist/${encodeURIComponent(email)}`, { method: 'DELETE' })
    }
    emails.value = (emails.value ?? []).filter(entry => entry.email !== email)
  }

  return { ...query, unavailable, add, remove }
}

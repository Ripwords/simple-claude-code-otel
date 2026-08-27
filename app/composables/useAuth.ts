export interface AuthState {
  signedIn: boolean
  /** False when the deployment has no DASHBOARD_PASSWORD_HASH, so nobody can sign in. */
  configured: boolean
}

const LOCKED: AuthState = { signedIn: false, configured: false }

export function useAuthState() {
  return useState<AuthState | null>('auth', () => null)
}

/**
 * The cookie is httpOnly, so the server is the only thing that can answer this.
 * A failed read locks the dashboard rather than opening it. Read once per page
 * load; the state is hydrated from the server render and kept across client
 * navigations.
 */
export async function loadAuthState(): Promise<AuthState> {
  const state = useAuthState()
  if (state.value) return state.value

  const request = useRequestFetch()
  try {
    state.value = await request<AuthState>('/api/auth/me')
  } catch {
    state.value = LOCKED
  }

  return state.value!
}

export function useAuth() {
  const state = useAuthState()

  const signedIn = computed(() => state.value?.signedIn ?? false)
  const configured = computed(() => state.value?.configured ?? false)

  async function signIn(password: string): Promise<void> {
    await $fetch('/api/auth/login', { method: 'POST', body: { password } })
    state.value = { signedIn: true, configured: true }
  }

  async function signOut(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    state.value = { signedIn: false, configured: configured.value }
    await navigateTo('/login')
  }

  return { signedIn, configured, signIn, signOut }
}

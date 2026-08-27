<script setup lang="ts">
const { configured, signIn } = useAuth()

const password = ref('')
const error = ref('')
const busy = ref(false)
const field = ref<HTMLInputElement | null>(null)

// `/api/auth/me` reports `configured` from the password hash alone, but signing in
// also needs SESSION_SECRET, so a 503 on submit means the same thing.
const missingSecret = ref(false)
const locked = computed(() => !configured.value || missingSecret.value)

const errorId = 'login-error'

async function submit() {
  if (busy.value || password.value.length === 0) return

  busy.value = true
  error.value = ''

  try {
    await signIn(password.value)
    await navigateTo('/')
  } catch (failure) {
    const code = statusOf(failure)
    if (code === 503) {
      missingSecret.value = true
    } else if (code === 401) {
      error.value = 'Wrong password.'
    } else if (code === undefined) {
      error.value = 'The request never reached the server. Check your connection and try again.'
    } else {
      error.value = `The server answered ${code}. You are not signed in.`
    }
    field.value?.select()
  } finally {
    busy.value = false
  }
}

onMounted(() => field.value?.focus())
</script>

<template>
  <div class="gate">
    <template v-if="locked">
      <p class="viz-eyebrow">
        Not configured
      </p>

      <h1 class="headline">
        This deployment has no password, so nobody can sign in
      </h1>

      <p class="viz-prose lede">
        The dashboard stays locked until both
        <span class="viz-code">DASHBOARD_PASSWORD_HASH</span> and
        <span class="viz-code">SESSION_SECRET</span> are set. One command prints both.
      </p>

      <ol class="steps">
        <li class="viz-prose">
          Run <span class="viz-code">bun run auth:hash</span> and choose a password of at least
          twelve characters. It prints one line for each variable.
        </li>
        <li class="viz-prose">
          Put both lines in <span class="viz-code">.env.local</span> for local use, and in your
          deployment's environment variables for the deployed dashboard.
        </li>
        <li class="viz-prose">
          Restart the server and reload this page. The password itself is never stored, only its
          hash.
        </li>
      </ol>
    </template>

    <template v-else>
      <p class="viz-eyebrow">
        Restricted
      </p>

      <h1 class="headline">
        This dashboard is private
      </h1>

      <form
        class="form"
        @submit.prevent="submit"
      >
        <label
          class="viz-eyebrow label"
          for="password"
        >
          Password
        </label>

        <input
          id="password"
          ref="field"
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          :aria-describedby="error ? errorId : undefined"
          :aria-invalid="error ? 'true' : undefined"
          class="input viz-mono viz-focus"
        >

        <button
          type="submit"
          class="submit viz-mono viz-focus"
          :disabled="busy || password.length === 0"
        >
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p
        :id="errorId"
        class="error viz-mono"
        role="status"
        aria-live="polite"
      >
        {{ error }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.gate {
  max-width: 54ch;
  padding: clamp(48px, 14vh, 132px) 0 72px;
}

.headline {
  margin: 10px 0 0;
  font-size: clamp(1.35rem, 4vw, 1.9rem);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.018em;
  color: var(--viz-ink);
}

.lede {
  margin-top: 18px;
}

.form {
  display: grid;
  gap: 10px;
  margin-top: 40px;
  padding-top: 22px;
  border-top: 1px solid var(--viz-baseline);
}

.label {
  color: var(--viz-ink-secondary);
}

.input {
  width: 100%;
  min-width: 0;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--viz-baseline);
  background: transparent;
  color: var(--viz-ink);
  font-size: 16px;
  letter-spacing: 0.16em;
}

.input[aria-invalid="true"] {
  border-bottom-color: var(--viz-status-critical);
}

.submit {
  justify-self: start;
  margin-top: 12px;
  padding: 8px 18px;
  border: 1px solid var(--viz-ink);
  background: transparent;
  color: var(--viz-ink);
  font-size: 12px;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.submit:hover:not(:disabled) {
  background: var(--viz-ink);
  color: var(--viz-surface);
}

.submit:disabled {
  border-color: var(--viz-grid);
  color: var(--viz-muted);
  cursor: not-allowed;
}

.error {
  min-height: 1.5em;
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--viz-status-critical);
}

.steps {
  margin: 26px 0 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.steps li {
  position: relative;
  counter-increment: step;
  padding: 14px 0 14px 34px;
  border-top: 1px solid var(--viz-grid);
}

.steps li::before {
  content: counter(step, decimal-leading-zero);
  position: absolute;
  left: 0;
  top: 15px;
  font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--viz-muted);
}
</style>

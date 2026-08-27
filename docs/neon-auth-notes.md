# Neon Auth notes

Research findings for gating this Nuxt 4 dashboard behind a login. Written 2026-08-27.

Every claim below is tagged with how it was established:

- **[live]** — verified by hitting this project's own Neon Auth server at `NEON_AUTH_BASE_URL`, or by running a read-only `SELECT` against `DATABASE_URL_UNPOOLED`.
- **[pkg]** — read out of the published npm tarball named in the line.
- **[docs]** — official Neon or better-auth documentation, URL given.
- **[skill]** — `.agents/skills/neon/SKILL.md` in this repo.

This project's Neon Auth server:
`https://ep-soft-leaf-azds12dw.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth`

---

## 1. What Neon Auth is

It is a **Better Auth server that Neon runs for you**. It is not a schema convention, and you do not run better-auth inside your own app.

The auth server lives at `NEON_AUTH_BASE_URL`. It is a real, reachable, running better-auth instance:

```
GET  {BASE}/ok                     -> 200 {"ok":true}
GET  {BASE}/get-session            -> 200 null
GET  {BASE}/list-sessions          -> 401 {"message":"Unauthorized","code":"UNAUTHORIZED"}
POST {BASE}/sign-in/email  {}      -> 400 {"message":"[body.email] Invalid input: expected string, received undefined; ...","code":"VALIDATION_ERROR"}
```

Those are better-auth's own route names and its own Zod error envelope. **[live]**

Neon's own wording: "Auth — Managed Better Auth with users and sessions stored in Postgres. *Generally available.*" **[skill]** The docs put it as "Managed Better Auth is the managed authentication service in the Neon backend… It stores users, sessions, and auth configuration directly in your Neon database" (https://neon.com/docs/auth/overview). **[docs]**

Consequences that matter for this app:

- **You never mount a better-auth `auth.handler()`.** There is no `betterAuth({...})` server config in your codebase, no `database:` adapter, no `secret`. Neon owns all of it.
- **You do not control better-auth server options.** `trustedOrigins`, `emailAndPassword.disableSignUp`, which plugins are enabled — all of it is Neon control-plane config, changed through the Neon CLI/Console/API, not through code. Section 4 and 5 cover how.
- The `neon_auth` schema is the *storage*, not the interface. Writing to it directly is not the supported path.

The live server config row confirms what is turned on: **[live]**

```sql
SELECT * FROM neon_auth.project_config;
```

```
trusted_origins    []
allow_localhost    t
social_providers   [{"id": "google", "isShared": true}]
email_provider     {"type": "shared"}
email_and_password {"enabled": true, "disableSignUp": false,
                    "emailVerificationMethod": "otp",
                    "requireEmailVerification": false, ...}
plugin_configs     {"organization": {"enabled": true, ...},
                    "magicLink":    {"enabled": false, ...},
                    "phoneNumber":  {"enabled": false, ...}}
webhook_config     {"enabled": false, ...}
```

Note `"disableSignUp": false`. **Open sign-up is on right now.** Section 5.

Docs caveat: Neon Auth is Beta and AWS-only, and is incompatible with IP Allow and Private Networking (https://neon.com/docs/auth/overview). **[docs]** Your project is on AWS `ap-southeast-1`, so that is fine.

---

## 2. Packages

Verified against `registry.npmjs.org` on 2026-08-27. **[live]**

| Package | Exists | Latest | Published |
|---|---|---|---|
| `@neondatabase/auth` | yes | **0.5.0-beta** | 2026-08-11 |
| `@neondatabase/auth-ui` | yes | 0.3.0-beta | 2026-08-11 |
| `@neondatabase/neon-js` | yes | 0.7.0-beta | 2026-08-11 |
| `better-auth` | yes | **1.7.2** | 2026-08-26 |
| `@neon/auth` | **no — 404** | | |
| `@neondatabase/auth-react` | **no — 404** | | |
| `neon-auth` | **no — 404** | | |
| `@better-auth/vue` | **no — 404** | | |
| `@better-auth/nuxt` | **no — 404** | | |
| `nuxt-better-auth` | yes (community) | 0.6.1 | 2026-08-26 |

`@neondatabase/serverless@1.1.0` (already a dependency here) is a plain Postgres driver. It has **no** auth export. **[pkg]**

### What is actually inside `@neondatabase/auth@0.5.0-beta`

Its `package.json` `exports` map: **[pkg]**

```
"."                 -> createAuthClient, BetterAuthVanillaAdapter (default)
"./vanilla"         -> BetterAuthVanillaAdapter, SupabaseAuthAdapter
"./vanilla/adapters"
"./react", "./react/ui", "./react/adapters"
"./next", "./next/server"
"./server"          -> framework-agnostic server toolkit
"./types"
```

There is **no `./vue` and no `./nuxt` export.** The two entrypoints relevant to Nuxt are `.` (vanilla client) and `./server` (adapter toolkit).

Its dependencies: `better-auth@1.6.23`, `@better-fetch/fetch@1.3.1`, `jose@6.2.5`, `zod@4.3.6`, `@supabase/auth-js`, `@neondatabase/auth-ui`. **[pkg]**

Its peer dependencies are `react >=18`, `react-dom >=18`, `next >=16` — **all three marked `optional: true`** in `peerDependenciesMeta`, so installing it in a Nuxt app does not drag React in and does not warn. **[pkg]** The React/Next code sits behind subpath exports you never import.

### Install

```
ni @neondatabase/auth
```

That is the only package you need. Do **not** also install `better-auth` directly — it comes in transitively, and `@neondatabase/auth` pins it (1.6.23) to match what Neon runs server-side. Installing your own copy at 1.7.2 buys you a version skew for nothing.

Skip `@neondatabase/auth-ui` (React-only components) and `nuxt-better-auth` (a community module that assumes you run the better-auth *server* locally, which you do not).

Version-skew note worth flagging: https://neon.com/docs/auth/overview says the service "currently supports Better Auth version 1.4.18", while the SDK pins 1.6.23. **[docs]** One of the two is stale. It has not bitten anything I probed, but it is why you should not hand-roll requests against undocumented better-auth routes.

---

## 3. Nuxt integration

### The blunt part first

**There is no official Nuxt support and none is on the roadmap.** https://neon.com/docs/auth/roadmap lists Next.js, Vite + React, React Router, and TanStack Router as supported, with "standalone frontend + backend" and other frameworks "based on demand". Nuxt, Vue, and SvelteKit appear on neither list. **[docs]**

So: no `createNeonAuth()` for Nitro, no `useSession()` composable, no drop-in middleware. What Neon ships instead is `@neondatabase/auth/server`, an explicitly framework-agnostic toolkit, plus an 18KB `BUILDING-AN-ADAPTER.md` walkthrough inside the package that tells you exactly how to build the missing adapter. **[pkg]** It even names the frameworks it expects you to build for: "Hono, Remix, SolidStart, Express, Fastify, …". You are the Nuxt one.

The work is roughly 60-80 lines across three files. That is the real cost of choosing Neon Auth here, and it is on a subpath the package itself labels: "**Stability: beta.** Minor versions may include breaking changes with migration notes in the package CHANGELOG. Pin your peer dependency to a narrow range." **[pkg]**

### Pick the architecture first: proxy, not direct

There are two shapes, and the choice is forced by cookies.

**Direct (browser talks to `*.neon.tech`) — does not work for this requirement.**
The client can call `createAuthClient(NEON_AUTH_BASE_URL)` straight from the browser and it will sign in fine. But the session cookie is then set by the `neonauth.c-3.ap-southeast-1.aws.neon.tech` host. **The browser will never send that cookie to your `*.vercel.app` Nitro routes.** Your server cannot see the session at all.

It is worse than that. `vercel.app` and `neon.tech` are different eTLD+1, so this is cross-*site*, not cross-subdomain. better-auth's cookies default to `SameSite=Lax` (`package/dist/cookies/index.mjs` **[pkg]**), so the browser will not send the cookie even on the cross-site `fetch` to `/get-session`. And better-auth's own docs say the rest plainly: "If your Better Auth API is hosted on a different domain than your frontend, Safari may block authentication cookies entirely… auth working in Chrome but failing in Safari" (https://www.better-auth.com/docs/concepts/cookies). **[docs]** Their documented fix is a reverse proxy that makes the auth API same-origin. Direct mode supports client-side gating only, which is not gating.

**Proxy (recommended).**
You mount a catch-all Nitro route at `/api/auth/**` that forwards to the Neon Auth server. The toolkit rewrites the upstream `Set-Cookie` headers onto **your own origin**, so the session cookie becomes first-party. Your Nitro routes then read it directly. This is exactly what the bundled Next.js adapter does, and what `handleAuthProxyRequest` exists for. **[pkg]** Neon's own Next.js quick start is this shape: `createNeonAuth({ baseUrl, cookies: { secret } })` plus `export const { GET, POST } = auth.handler()` at `app/api/auth/[...path]/route.ts`, with the client created as `createAuthClient()` carrying **no** `baseURL` so it stays same-origin (https://neon.com/docs/auth/quick-start/nextjs-api-only). **[docs]** You are rebuilding those two files for Nitro.

Everything below assumes proxy mode.

### 3a. The catch-all auth route

Nitro's catch-all filename is `[...].ts`. h3 1.15.11 (what Nuxt 4.5.2 ships here) exports `toWebRequest(event)` and `sendWebResponse(event, response)`, which bridge H3 to the Web `Request`/`Response` the toolkit speaks. **[live]** — checked `node_modules/h3/dist/index.d.mts`.

`server/api/auth/[...].ts`:

```ts
import { handleAuthProxyRequest } from '@neondatabase/auth/server'

export default defineEventHandler(async (event) => {
  const { neonAuthBaseUrl, neonAuthCookieSecret } = useRuntimeConfig(event)
  const path = event.path.replace(/^\/api\/auth\//, '').split('?')[0]

  const response = await handleAuthProxyRequest({
    request: toWebRequest(event),
    path,
    baseUrl: neonAuthBaseUrl,
    cookieSecret: neonAuthCookieSecret,
    sameSite: 'lax'
  })

  return sendWebResponse(event, response)
})
```

`path` is the slash-joined remainder after the mount point, e.g. `sign-in/email`, `get-session`, `sign-out`. It is a string, not an array. **[pkg]**

### 3b. The client

`createAuthClient` from `@neondatabase/auth` defaults to `BetterAuthVanillaAdapter`, which is framework-agnostic — no React, no hooks. **[pkg]** Point it at your **own** `/api/auth` mount, not at `NEON_AUTH_BASE_URL`.

`app/utils/authClient.ts`:

```ts
import { createAuthClient } from '@neondatabase/auth'

export const authClient = createAuthClient('/api/auth')
```

The returned object is the better-auth client surface: `signIn.email`, `signIn.social`, `signUp.email`, `signOut`, `getSession`. **[pkg]** — from `dist/index.d.mts`.

Under the hood the vanilla adapter builds a better-auth client with these plugins pre-registered: `jwtClient`, `adminClient`, `organizationClient`, `emailOTPClient`, `magicLinkClient`, `phoneNumberClient`, `anonymousTokenClient`. **[pkg]** — read out of `dist/adapter-core-CZ8saNEY.mjs`. It also sets `fetchOptions.throw = false`, so calls resolve to `{ data, error }` rather than throwing.

### 3c. The sign-in page

```vue
<script setup lang="ts">
const email = ref('')
const password = ref('')
const errorMessage = ref('')

async function submit() {
  const { error } = await authClient.signIn.email({
    email: email.value,
    password: password.value
  })
  if (error) {
    errorMessage.value = error.message ?? 'Sign-in failed'
    return
  }
  await navigateTo('/')
}
</script>
```

The sign-in call goes to your own origin, so no CORS and no cross-site cookie. `better-auth`'s client sets `credentials: "include"` by default anyway — confirmed at `package/dist/client/config.mjs:39` of `better-auth@1.6.23`: `...isCredentialsSupported ? { credentials: "include" } : {}`. **[pkg]**

A wrong password comes back as `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}`. **[live]**

### 3d. Gating a Nitro route

The cookie names are exported constants: **[pkg]**

```ts
NEON_AUTH_COOKIE_PREFIX            = "__Secure-neon-auth"
NEON_AUTH_SESSION_COOKIE_NAME      = "__Secure-neon-auth.session_token"
NEON_AUTH_SESSION_DATA_COOKIE_NAME = "__Secure-neon-auth.local.session_data"
```

Do not confuse these with better-auth's stock names. Vanilla better-auth uses the `better-auth` prefix, giving `__Secure-better-auth.session_token`. **[pkg]** Neon's toolkit re-prefixes to `neon-auth` when it mints the first-party cookies on your origin. Grep for `neon-auth`, not `better-auth`, when you are staring at devtools.

Write one server util and call it from the four routes that need it.

`server/utils/session.ts`:

```ts
import {
  handleAuthProxyRequest,
  parseSessionData,
  type SessionData
} from '@neondatabase/auth/server'

export async function requireSession(event: H3Event): Promise<SessionData> {
  const { neonAuthBaseUrl, neonAuthCookieSecret } = useRuntimeConfig(event)

  const response = await handleAuthProxyRequest({
    request: toWebRequest(event),
    path: 'get-session',
    baseUrl: neonAuthBaseUrl,
    cookieSecret: neonAuthCookieSecret
  })

  const session = parseSessionData(await response.json())
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return session
}
```

Then in `server/api/stats/summary.get.ts` and its three siblings, one line at the top:

```ts
await requireSession(event)
```

Do **not** put this in a global Nitro middleware. `/api/otlp/*` and `/api/cron/*` must stay on their own bearer-token auth, and a global hook that you then have to punch holes in is the shape that leaks. Four explicit call sites is four lines and zero ambiguity.

The routes to gate, as they exist today:

```
server/api/stats/summary.get.ts
server/api/stats/timeseries.get.ts
server/api/stats/breakdown.get.ts
server/api/devices/acknowledge.post.ts
```

Left alone:

```
server/api/otlp/v1/logs.post.ts
server/api/otlp/v1/metrics.post.ts
server/api/cron/prune.get.ts
```

### 3e. Vue pages and route middleware

Two options, and the first is less code.

**Option 1 — use `better-auth/vue` directly.** Your `/api/auth` proxy speaks plain better-auth protocol, so better-auth's own Vue client works against it. `better-auth@1.7.2` does export `./vue`, and `createAuthClient` there returns a proxy carrying `useSession`, `hydrateSession`, `$fetch`, and `$store` (verified in `package/dist/client/vue/index.mjs` of the 1.7.2 tarball). **[pkg]** `useSession()` with no argument returns a Vue ref; `useSession(useFetch)` is the SSR-safe form that delegates to Nuxt's `useFetch`, documented at https://www.better-auth.com/docs/integrations/nuxt. **[docs]**

```vue
<script setup lang="ts">
const { data: session } = await authClient.useSession(useFetch)
</script>
```

That SSR form works only because `baseURL` is same-origin. Pointed at the Neon host it is an external URL, Nuxt will not attach cookies during SSR, and it returns `null` on the server render. One more reason proxy mode is the only sane shape.

The cost of option 1 is a second, unpinned copy of `better-auth` in your tree at 1.7.2 alongside the 1.6.23 that `@neondatabase/auth` pins, plus you lose the Neon client's pre-registered plugin set and its OAuth `token_verifier` handling.

**Option 2 — hand-roll it on the Neon vanilla client.** Slightly more code, one dependency, no version skew. Build the composable with `useState` so SSR and client share it.

`app/composables/useAuthSession.ts`:

```ts
export function useAuthSession() {
  return useState<SessionData | null>('auth-session', () => null)
}
```

`app/plugins/auth.ts` (fetches once, works on both sides of SSR):

```ts
export default defineNuxtPlugin(async () => {
  const session = useAuthSession()
  if (session.value) return

  const headers = useRequestHeaders(['cookie'])
  const { data } = await useFetch('/api/auth/get-session', { headers })
  session.value = (data.value as SessionData | null) ?? null
})
```

`useRequestHeaders(['cookie'])` is load-bearing — see gotcha 8a.

`app/middleware/auth.global.ts`:

```ts
export default defineNuxtRouteMiddleware((to) => {
  const session = useAuthSession()
  if (!session.value?.user && to.path !== '/sign-in') {
    return navigateTo('/sign-in')
  }
})
```

This is a UX redirect, not a security boundary. The security boundary is `requireSession` in section 3d. Both are needed; only one is trusted.

---

## 4. Creating the first user, and closing sign-up

### Right now, anyone who knows your base URL can create an account.

`{BASE}/sign-up/email` is live and `disableSignUp` is `false`. **[live]** Only the trusted-origin check stands between the open internet and a new row in `neon_auth.user`, and `allow_localhost` is `true`, so `Origin: http://localhost:3000` sails through. Verified against the real server:

```
POST {BASE}/sign-in/email
  Origin: http://localhost:3000     -> 401 INVALID_EMAIL_OR_PASSWORD   (reached the password check)
  Origin: https://evil.example.com  -> 403 {"message":"Invalid origin","code":"INVALID_ORIGIN"}
```

**[live]** So the gate exists, but it is one header any script can set, and localhost is permanently open. Do not rely on it.

The database currently holds zero users, zero sessions, zero JWKS rows. **[live]**

### The fix: create your one user, then turn sign-up off

Neon's CLI has a full `neon-auth` command tree. I extracted it from the published `neon@4.8.0` tarball (`package/dist/commands/neon_auth.js`) rather than trusting docs. **[pkg]**

```
neon neon-auth user create --email <email> [--name <name>]
neon neon-auth user delete <user-id>
neon neon-auth user set-role <user-id> --roles <role...>

neon neon-auth config email-password get
neon neon-auth config email-password update --disable-sign-up true
neon neon-auth config email-password update --require-email-verification true

neon neon-auth domain list
neon neon-auth domain add <domain>
neon neon-auth domain delete <domain>
neon neon-auth domain allow-localhost get|enable|disable

neon neon-auth plugins list
neon neon-auth config organization update --enabled false
neon neon-auth oauth-provider list|add|update|delete
neon neon-auth status | enable | disable
```

So the sequence is:

1. `neon neon-auth user create --email you@example.com --name "You"`
   Prints the new user's ID and email. It does **not** print or set a password — `userCreate` sends only `{ email, name }` to `createBranchNeonAuthNewUser`. **[pkg]**
2. Set a password via `POST {BASE}/request-password-reset` (live, 400 on empty body — the route exists **[live]**), or skip passwords entirely and sign in with email OTP: `POST {BASE}/email-otp/send-verification-otp` with `{ email, type: "sign-in" }`, then `POST {BASE}/sign-in/email-otp` with `{ email, otp }`. Both routes are live. **[live]** The shared email provider (`email_provider: {"type": "shared"}`) delivers the mail.
3. `neon neon-auth config email-password update --disable-sign-up true`
4. `neon neon-auth domain allow-localhost disable` once you stop developing locally.
5. Verify with `SELECT email_and_password, allow_localhost FROM neon_auth.project_config;`

**Correction to the docs:** https://neon.com/docs/auth/guides/user-management says signup restrictions are "coming soon". That page is stale. **[docs]** The `disable_sign_up` flag exists in the shipped CLI **[pkg]** and the `disableSignUp` key is already present in this project's live `project_config.email_and_password` JSON **[live]**. Trust the CLI and the database over the doc page.

**Also disable Google.** `social_providers` currently has `[{"id": "google", "isShared": true}]`, so `POST {BASE}/sign-in/social` with `provider: "google"` is a second, separate way to create an account, and `disable-sign-up` on the email/password config does not cover it. Remove it with `neon neon-auth oauth-provider delete --provider-id google` if you do not intend to use it.

I did not find a Console "add user" button documented. The CLI path is confirmed; the Console path is not.

**CLI install is broken today.** `npx neon@latest` fails with `npm error notarget No matching version found for @neon/config-runtime@1.0.5`. **[live]** `@neon/config@1.0.5` was published a few hours ago and its runtime sibling has not landed. Retry later, or pin an older `neon` version, or use the REST API at `POST /projects/{project_id}/branches/{branch_id}/auth/users`.

---

## 5. Trusted domains

Managed in three places (https://neon.com/docs/auth/guides/configure-domains): Console under **Auth → Configuration → Domains**, the CLI commands above, and the API at `POST /projects/{project_id}/branches/{branch_id}/auth/domains`. **[docs]**

### The error string

The skill says sign-in fails with `invalid domain`. **[skill]** The actual wire response is:

```
403 {"message":"Invalid origin","code":"INVALID_ORIGIN"}
```

**[live]** Close enough to recognise, but grep for `INVALID_ORIGIN`, not `invalid domain`.

### What to register

- **`http://localhost:3000` — register nothing.** Localhost is covered by the `allow_localhost` boolean, which is `true` on this project. **[live]** Any port works. Docs: "Development domains are automatically allowed", and the production checklist tells you to switch it off before launch (https://neon.com/docs/auth/production-checklist). **[docs]**
- **Vercel production** — register the **origin only**: scheme included, no trailing slash, no path.
  `neon neon-auth domain add https://simple-claude-code-otel.vercel.app`
  `https://myapp.com/` with the trailing slash is rejected; subdomains are not implied, so `www.` needs its own entry. **[docs]**
- **Vercel previews** — wildcards are supported: `https://*.vercel.app`, or narrower, `https://*-yourteam.vercel.app`. **[docs]** Neon's Vercel-marketplace integration is documented as configuring preview URLs automatically (https://neon.com/blog/auth-that-just-works-in-vercel-previews), but this project's `trusted_origins` is `[]` **[live]**, so nothing has been auto-registered here. Add them yourself.

### One thing that will mislead you while debugging

The CORS preflight reflects **any** origin:

```
OPTIONS {BASE}/sign-in/email
  Origin: https://evil.example.com
  -> 204, access-control-allow-origin: https://evil.example.com
     access-control-allow-credentials: true
```

**[live]** The trusted-origin check runs on the **actual** request, not the preflight. A green preflight in devtools tells you nothing about whether your domain is registered.

In proxy mode (section 3) the origin the auth server sees is the one your Nitro proxy forwards, which is your app's origin. So you still register your app's domain — the proxy does not exempt you.

---

## 6. Environment variables

| Variable | Where | Secret? | Notes |
|---|---|---|---|
| `NEON_AUTH_BASE_URL` | server | no, but keep it server-side | The auth server endpoint. Already in `.env.local`. In proxy mode only Nitro needs it. |
| `NEON_AUTH_COOKIE_SECRET` | server | **yes** | **You must add this.** Signs the `session_data` cookie the proxy mints. `createAuthServer()` validates it at call time and throws if missing or under 32 chars. **[pkg]** Generate with `openssl rand -base64 32`. |
| `VITE_NEON_AUTH_URL` | — | no | Vercel provisioned it for a Vite/React app. **Nuxt does not read `VITE_*`.** |
| `DATABASE_URL` | server | yes | Already wired. Not used by auth. |

### On `VITE_NEON_AUTH_URL`

Nuxt has no `VITE_` convention — Nuxt exposes browser values through `runtimeConfig.public`, which maps to `NUXT_PUBLIC_*` env vars, not `VITE_*`. So the variable as provisioned is inert here.

But in proxy mode **you do not need a browser-visible auth URL at all.** The client points at the relative path `/api/auth`. So the right move is to leave `VITE_NEON_AUTH_URL` alone as dead weight from the marketplace provisioner, and not re-expose it under any name. Shipping the Neon host to the browser only widens what an attacker can hit directly.

`nuxt.config.ts` gains two server-side keys:

```ts
runtimeConfig: {
  databaseUrl: process.env.DATABASE_URL || '',
  ingestToken: process.env.INGEST_TOKEN || '',
  retentionDays: process.env.RETENTION_DAYS || '90',
  neonAuthBaseUrl: process.env.NEON_AUTH_BASE_URL || '',
  neonAuthCookieSecret: process.env.NEON_AUTH_COOKIE_SECRET || '',
  public: {
    appName: 'Claude Code Telemetry'
  }
}
```

On Vercel, add `NEON_AUTH_COOKIE_SECRET` to the project's environment variables. The Neon-provisioned ones are already synced by the marketplace integration.

There is no API key or service token for Neon Auth. The base URL is the whole address, and trusted domains is the only gate in front of it.

---

## 7. Session validation: what actually happens per request

Three mechanisms exist on this server. Two are real options; one is not.

### (a) Cookie forwarded upstream — the default, and it is a network call

`handleAuthProxyRequest({ path: 'get-session' })` forwards the session cookie to `{BASE}/get-session` over HTTPS. Confirmed live: `GET {BASE}/get-session` returns `200 null` with no cookie. **[live]**

### (b) The signed `session_data` cookie — the fast path that saves the network call

This is the part that makes proxy mode worth the effort, and it is easy to miss.

When a sign-in response comes back, `handleAuthProxyRequest` mints a **second** cookie, `__Secure-neon-auth.local.session_data`, which is a JWT signed with **your** `cookieSecret`. On subsequent `get-session` calls the toolkit validates that cookie locally with `jose` and returns the cached payload without touching the network. The package documents this as the "< 1ms fast path". **[pkg]** — `handleAuthProxyRequest` JSDoc: "2. Try session cache if applicable (< 1ms fast path) / 3. Call upstream Neon Auth API".

TTL is `sessionDataTtl`, **default 300 seconds**. **[pkg]** So a gated request costs a local Ed25519-signature check, and hits Neon at most once every 5 minutes. That is the answer to "does every gated request make a network call": **no, roughly one in every 5 minutes of traffic does.**

`validateSessionData(sessionDataString, cookieSecret)` is exported if you ever want to do the check yourself. **[pkg]**

Trade-off to know: `sessionDataTtl` is also your revocation lag. Sign out on one device and a stale `session_data` cookie elsewhere stays valid for up to 300s. For a single-user dashboard that is fine. Lower it if it is not.

### (c) JWT via JWKS — available, but not the right tool here

The JWKS endpoint is live at a path that is easy to guess wrong:

```
GET {BASE}/.well-known/jwks.json
-> 200 {"keys":[{"alg":"EdDSA","crv":"Ed25519","x":"WqkZRJw8dLleiMvc-P4a4zLTtpb6-av1bHb5qIK35i8","kty":"OKP","kid":"81ebcc98-669b-4692-b097-3a3b2008e29a"}]}
```

**[live]** Note `{BASE}/jwks` is a 404. **[live]**

`GET {BASE}/token` mints a JWT and returns `401 UNAUTHORIZED` without a session. **[live]** Tokens are EdDSA/Ed25519 with a **15-minute** expiry and no custom claims (https://neon.com/docs/auth/guides/plugins/jwt). **[docs]**

Why not use it for gating: you still need a valid session cookie to *get* a token, so it does not remove a round trip — it adds one, plus a refresh loop, plus it cannot protect SSR page loads because there is no cookie for the server to read. The docs say it outright: "This plugin is **not** a replacement for session management in web applications." **[docs]** It is for the Data API's RLS, for microservices, and for CLI clients.

### (d) Reading `neon_auth.session` directly — don't

The table is there and has a unique index on `token`, so it is technically queryable. **[live]** But nothing in the docs sanctions it, and it means reimplementing better-auth's expiry, rotation, and cookie-signature rules by hand against a schema Neon can migrate under you. It also gains you nothing over (b), which is already local and already fast.

---

## 8. Nuxt-specific gotchas

**a. `useFetch` does not forward cookies during SSR.**
The biggest one. On the server, `useFetch('/api/auth/get-session')` runs inside Nitro with no browser attached, so the incoming request's `Cookie` header is not automatically passed to the internal call. The session comes back `null` on first paint and then populates on the client, giving you a login-flash on every hard reload. Fix is `useRequestHeaders(['cookie'])`, as in 3e. Nuxt strips `cookie` from `useRequestHeaders()` unless you name it explicitly.

**b. The auth route must be a catch-all, and it must not be method-suffixed.**
`server/api/auth/[...].ts`, not `[...].get.ts` or `[...].post.ts`. better-auth uses both verbs across its routes (`GET get-session`, `POST sign-in/email`), and a method suffix silently 404s the other half.

**c. Do not let a body parser touch the auth route.**
`BUILDING-AN-ADAPTER.md` is explicit: "The toolkit forwards the body verbatim to upstream; pre-parsed JSON ruins upstream signature verification." **[pkg]** `toWebRequest(event)` hands over the raw stream, so as long as you do not call `readBody(event)` first, you are fine. Calling `readBody` before `toWebRequest` will break sign-in in a way that looks like a server bug.

**d. Multiple `Set-Cookie` headers.**
Sign-in returns more than one cookie. `sendWebResponse` handles the array form correctly. If you ever hand-roll the response, use `response.headers.getSetCookie()` — `.get('set-cookie')` comma-merges them, and any cookie carrying `Expires=Wed, 01 Jan 1970` gets corrupted by the comma inside the date. **[pkg]**

**e. `@neondatabase/auth` is ESM-only.** **[pkg]** Nuxt 4 + Nitro are ESM throughout, so this is a non-issue here. It matters only if something in your build tries to `require()` it.

**f. Vercel preset.** `nitro.preset: 'vercel'` is already set. The toolkit is Web-Standards-only (`Request`/`Response`), which is what the Vercel Node and Edge runtimes both speak, so no preset-specific work. The one thing to watch: the existing `/api/cron/prune` cron entry in `nuxt.config.ts` must keep working *without* a session, which it will as long as you gate per-route (3d) rather than globally.

**g. `sameSite` on the minted cookies.** Defaults to `'strict'` in `createAuthServer`, but `'lax'` in `handleAuthProxyRequest`'s own config. **[pkg]** Set it explicitly. Use `'lax'` if you ever add Google OAuth — a `'strict'` cookie is not sent on the top-level cross-site navigation back from Google's consent screen, and the callback lands unauthenticated.

**h. Trusted domains and preview deploys.** Every Vercel preview gets a fresh `*.vercel.app` hostname. Without a wildcard entry (section 5), every preview build fails sign-in with `INVALID_ORIGIN` and nothing else. Register the wildcard once.

---

## Verdict

Neon Auth is a workable fit for this app, but not a comfortable one, and the discomfort is worth naming precisely.

**What actually works.** The server is real, running, and reachable; the endpoints behave exactly like better-auth; the toolkit at `@neondatabase/auth/server` is genuinely framework-agnostic and gives you the local-signature fast path so gating is not a per-request network call. Nothing here is fundamentally blocked on Nuxt.

**What it costs.** You write the Nuxt adapter that Neon writes for Next.js — three small files, no first-party support, no upgrade path if the toolkit's beta subpath breaks in a minor. You inherit two beta surfaces at once (`@neondatabase/auth@0.5.0-beta`, and the service itself, which the docs still call Beta). And the docs you would reach for are stale in at least two places I checked: signup restrictions are documented as "coming soon" but shipped, and the better-auth version is documented as 1.4.18 but pinned at 1.6.23.

**The security posture as it stands right now is wrong for a single-user dashboard**, and this is the thing to fix first regardless of which direction you go. `disableSignUp` is `false`, shared Google OAuth is enabled, and localhost is permanently trusted. Anyone who learns your `NEON_AUTH_BASE_URL` can mint an account with `Origin: http://localhost:3000`. That is three CLI commands away from being closed, but it is open today.

**The honest alternative.** For one user on a self-hosted dashboard, most of what Neon Auth provides — organizations, OAuth, invitations, email OTP, JWKS — is surface you will never use, and every bit of it is surface you now have to keep closed. A signed session cookie against a single bcrypt hash in an env var is perhaps forty lines of Nitro with no beta dependencies and no external control plane to keep in sync. If the reason to use Neon Auth is "it is already provisioned", that is a weak reason. If the reason is that you expect real users later, it is a good one, and the proxy architecture in section 3 is the right way to build it.

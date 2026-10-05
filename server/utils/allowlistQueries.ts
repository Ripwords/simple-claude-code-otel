import { createError } from 'h3'
import { z } from 'zod'
import type { AllowedEmail } from '../../shared/types'
import { db } from './db'
import { redis } from './buffer'

// Trimmed before the format check. Chaining .trim() after z.email() runs too late,
// so a padded address would be refused as malformed rather than cleaned up.
export const emailSchema = z.string().trim().max(254).pipe(z.email())

export const bodyEmailSchema = z.object({ email: emailSchema })

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

// The wire carries whatever the machine put in `user.email`, so it is parsed rather than
// trusted: an unusable address becomes null instead of an unbounded string on a row the
// dashboard renders. Null never matches the allowlist, so refusal is the outcome either way.
export function accountEmail(raw: string | null): string | null {
  if (raw === null) return null
  const parsed = emailSchema.safeParse(raw)
  return parsed.success ? normalizeEmail(parsed.data) : null
}

export function parseAllowedEmail(input: unknown): string {
  const parsed = bodyEmailSchema.safeParse(input)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email', data: z.treeifyError(parsed.error) })
  }
  return normalizeEmail(parsed.data.email)
}

export function parseEmailParam(raw: string | undefined): string {
  const parsed = emailSchema.safeParse(raw)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  return normalizeEmail(parsed.data)
}

export async function listAllowedEmails(): Promise<AllowedEmail[]> {
  const rows = await db().query(
    `select coalesce(a.email, d.email) as email, a.created_at, (a.email is not null) as manual
     from telemetry.allowed_email a
     full outer join (select distinct lower(account_email) as email from telemetry.device where account_email is not null) d
       on d.email = a.email
     order by 1`,
    []
  )

  return rows.map((row) => {
    const manual = row.manual === true
    return {
      email: String(row.email),
      source: manual ? 'manual' : 'device',
      addedAt: manual ? timestamp(row.created_at) : null
    }
  })
}

// Cached because a guest account reporting through another machine's token asks this on every
// batch. The explicit list clears its entry on change; a machine-owner email can lag a claim or
// release by the TTL, which only delays a guest being admitted or refused by minutes.
const ALLOWED_TTL_SECONDS = 5 * 60
const allowedKey = (email: string) => `allow:${email}`

export async function isEmailAllowed(email: string | null): Promise<boolean> {
  if (email === null) return false
  const normalized = normalizeEmail(email)
  const store = redis()

  const hit = store ? await store.get<string>(allowedKey(normalized)).catch(() => null) : null
  if (hit !== null) return hit === '1'

  const rows = await db().query(
    `select exists(
       select 1 from telemetry.allowed_email where email = $1
       union all
       select 1 from telemetry.device where lower(account_email) = $1
     ) as allowed`,
    [normalized]
  )
  const allowed = rows[0]?.allowed === true
  await store?.set(allowedKey(normalized), allowed ? '1' : '0', { ex: ALLOWED_TTL_SECONDS }).catch(() => null)
  return allowed
}

export async function addAllowedEmail(email: string): Promise<AllowedEmail> {
  const rows = await db().query(
    `with inserted as (
       insert into telemetry.allowed_email (email) values ($1) on conflict (email) do nothing returning created_at
     )
     select coalesce(
       (select created_at from inserted),
       (select created_at from telemetry.allowed_email where email = $1)
     ) as created_at`,
    [email]
  )
  // After the write, not before: a lookup landing in between would re-cache the old answer.
  await redis()?.del(allowedKey(email))
  return { email, source: 'manual', addedAt: timestamp(rows[0]?.created_at) }
}

export async function removeAllowedEmail(email: string): Promise<void> {
  const rows = await db().query('delete from telemetry.allowed_email where email = $1 returning email', [email])
  await redis()?.del(allowedKey(email))
  if (!rows[0]) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That email is not a manual allowlist entry. A machine-owner email is removed by releasing that machine.'
    })
  }
}

function timestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string).toISOString()
}

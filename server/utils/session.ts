import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { H3Event } from 'h3'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

const COOKIE_NAME = 'dashboard_session'
const SESSION_DAYS = 30
const KEY_LENGTH = 32

export function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  return scryptAsync(password, salt, KEY_LENGTH)
    .then(key => `scrypt$${salt.toString('hex')}$${key.toString('hex')}`)
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false

  const expected = Buffer.from(keyHex, 'hex')
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

export function issueSession(event: H3Event, secret: string): void {
  const expiresAt = Date.now() + SESSION_DAYS * 86_400_000
  setCookie(event, COOKIE_NAME, `${expiresAt}.${sign(String(expiresAt), secret)}`, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400
  })
}

export function clearSession(event: H3Event): void {
  deleteCookie(event, COOKIE_NAME, { path: '/' })
}

export function hasSession(event: H3Event, secret: string): boolean {
  if (!secret) return false

  const [expiresAt, signature] = (getCookie(event, COOKIE_NAME) ?? '').split('.')
  if (!expiresAt || !signature) return false
  if (Number(expiresAt) < Date.now()) return false

  const expected = Buffer.from(sign(expiresAt, secret), 'hex')
  const presented = Buffer.from(signature, 'hex')
  return expected.length === presented.length && timingSafeEqual(expected, presented)
}

// An unset password hash locks the dashboard rather than opening it. A deployment
// missing its configuration must not be a deployment anyone can read.
export function requireSession(event: H3Event): void {
  const { sessionSecret } = useRuntimeConfig(event)
  if (!hasSession(event, String(sessionSecret ?? ''))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

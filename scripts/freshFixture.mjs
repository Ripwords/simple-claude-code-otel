import { readFileSync } from 'node:fs'

/**
 * Loads a captured OTLP fixture with every timestamp shifted so the newest lands a minute ago.
 * The dashboard answers anything before today from the daily rollups, so a fixture replayed
 * with its capture-day timestamps lands in raw rows no query reads, and every check that
 * compares totals sees nothing. The gaps between timestamps are kept, so no two datapoints
 * collapse onto one dedupe key.
 */
export function freshFixture(path) {
  const text = readFileSync(path, 'utf8')
  const stamps = [...text.matchAll(/"(?:start)?[tT]imeUnixNano":\s*"(\d+)"/g)].map(m => BigInt(m[1]))
  const newest = stamps.reduce((a, b) => (b > a ? b : a), 0n)
  const shift = BigInt(Date.now() - 60_000) * 1_000_000n - newest
  return JSON.parse(text.replace(/("(?:start)?[tT]imeUnixNano":\s*")(\d+)"/g, (_, head, ns) => `${head}${BigInt(ns) + shift}"`))
}

/**
 * Drives the redesigned dashboard in a real browser against the seeded local stack, checks
 * what a person would check by eye, and leaves screenshots plus a JSON report behind.
 *
 * Needs: `nr e2e:up`, `nr seed:e2e`, and `nr e2e:dev` running on :3100.
 * Run with: bun --env-file=test/e2e/stack.env scripts/verify-redesign.ts
 * Artifacts: test/e2e/artifacts/redesign/after-*.png and report.json
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import type { DeviceSummary } from '#shared/types'

const BASE = 'http://localhost:3100'
const OUT = 'test/e2e/artifacts/redesign'
const PASSWORD = 'e2e-password-local'
const WIDTHS = [1440, 768, 414, 375, 320]

const results: Array<{ check: string, pass: boolean, detail: string }> = []
function check(name: string, pass: boolean, detail = '') {
  results.push({ check: name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const login = await context.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } })
if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
const page = await context.newPage()

const DAYS: Record<string, number> = { 'today': 0, '7d': 6, '30d': 29, '90d': 89 }

// Loads a dashboard URL and returns the summary rows for the same range and filter, asked of
// the API directly: the page fetches during server render, so the browser never sees it.
async function open(path: string): Promise<DeviceSummary[]> {
  await page.goto(`${BASE}${path}`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  const query = new URL(path, BASE).searchParams
  const now = new Date()
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (DAYS[query.get('range') ?? '7d'] ?? 6) * 86_400_000
  const params = new URLSearchParams({ from: new Date(start).toISOString(), to: now.toISOString() })
  if (query.get('devices')) params.set('devices', query.get('devices')!)
  const response = await context.request.get(`${BASE}/api/stats/summary?${params}`)
  return await response.json() as DeviceSummary[]
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// Fresh state: the "new" notice should show until dismissed.
await page.goto(`${BASE}/`)
await page.evaluate(() => localStorage.removeItem('cct:announced-devices'))

// 1. Screenshots across widths, schemes and ranges; no horizontal scroll anywhere.
for (const scheme of ['light', 'dark'] as const) {
  await page.emulateMedia({ colorScheme: scheme })
  for (const range of ['30d', 'today']) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await open(`/?range=${range}`)
      const extra = await overflow(page)
      check(`no horizontal scroll ${width}px ${scheme} ${range}`, extra <= 0, `${extra}px extra`)
      await page.screenshot({ path: `${OUT}/after-${range}-${width}-${scheme}.png`, fullPage: true })
      // The 13-column ledger is the widest thing on the page; opening it once widened the
      // whole page and slid it sideways when the summary took focus.
      const left = await page.locator('.page').evaluate(e => e.getBoundingClientRect().left)
      await page.locator('.ledger-summary').click()
      await page.locator('.ledger-summary').scrollIntoViewIfNeeded()
      const shifted = await page.locator('.page').evaluate(e => e.getBoundingClientRect().left)
      const extraOpen = await overflow(page)
      check(`ledger open keeps the page still ${width}px ${scheme} ${range}`, extraOpen <= 0 && Math.abs(shifted - left) < 1, `${extraOpen}px extra, moved ${Math.round(shifted - left)}px`)
    }
  }
}
await page.emulateMedia({ colorScheme: 'light' })
await page.setViewportSize({ width: 1440, height: 900 })

// 1b. Clicking the ledger with a mouse draws no focus box; the ring is for keyboard users.
await open('/?range=30d')
await page.locator('.ledger-summary').click()
check('mouse click on the ledger draws no focus ring', !await page.locator('.ledger-summary').evaluate(e => e.matches(':focus-visible')))
const latency = await page.locator('.ledger-table tbody tr').first().locator('td').last().innerText()
check('latency reads as ms or seconds, not raw decimals', /^(\d+ ms|\d+\.\d s|—)$/.test(latency.trim()), latency)

// 2. Hero total equals the sum of what the summary API returned.
const rows = await open('/?range=30d')
const apiTotal = rows.reduce((sum, row) => sum + row.costUsd, 0)
const heroText = (await page.locator('.stats .total').innerText()).trim()
const heroValue = Number(heroText.replace(/[^0-9.]/g, ''))
check('hero total matches summary API', Math.abs(heroValue - apiTotal) < Math.max(1, apiTotal * 0.005), `${heroText} vs $${apiTotal.toFixed(2)}`)

// 3. Page height at 1440.
const height = await page.evaluate(() => document.documentElement.scrollHeight)
check('page under 3000px tall at 1440', height < 3000, `${height}px`)

// 4. Leaderboard: one row per machine, and sorting reorders.
const boardRows = page.locator('table.board tbody tr')
check('leaderboard has one row per machine', await boardRows.count() === rows.length, `${await boardRows.count()} rows, ${rows.length} machines`)
const namesBefore = await page.locator('table.board tbody .device-name').allInnerTexts()
const bySpend = [...rows].sort((a, b) => b.costUsd - a.costUsd).map(r => r.device)
check('leaderboard starts sorted by spend', namesBefore[0] === bySpend[0], `first ${namesBefore[0]}`)
await page.locator('table.board thead th .sort', { hasText: 'Machine' }).click()
const namesAfter = await page.locator('table.board tbody .device-name').allInnerTexts()
const alpha = [...namesAfter].sort((a, b) => a.localeCompare(b))
check('sorting by machine reorders rows', JSON.stringify(namesAfter) === JSON.stringify(alpha) || JSON.stringify(namesAfter) === JSON.stringify([...alpha].reverse()), namesAfter.slice(0, 3).join(', '))

// 5. The busiest machines get colours, not grey. Read after re-sorting by spend.
await page.locator('table.board thead th .sort', { hasText: 'Spend' }).click()
const dots = await page.locator('table.board tbody tr').evaluateAll(trs => trs.slice(0, 5).map((tr) => {
  const dot = tr.querySelector('.dot') as HTMLElement | null
  return dot ? dot.style.backgroundColor : ''
}))
check('top five machines by spend are coloured', dots.length === 5 && dots.every(color => color.includes('--viz-series')), dots.join(' | '))

// 6. The models list opens on the busiest six and expands to all of them.
const modelRows = page.locator('ul.machines > li')
const firstCount = await modelRows.count()
await page.getByRole('button', { name: /Show all \d+ machines/ }).click()
check('models list opens on six and expands to every machine', firstCount === 6 && await modelRows.count() === rows.length, `${firstCount} then ${await modelRows.count()}`)

// 6b. Stacked chart: at most five named machines plus one "others" band.
const legend = await page.locator('.ts-legend li').allInnerTexts()
check('stacked chart names at most 5 machines plus Other', legend.length <= 6 && legend.length >= 2, legend.join(', '))

// 7. Status line: refused, waiting and new; dismissing "new" sticks across a reload.
const status = page.locator('ul.status')
const kinds = await status.locator('li.item').evaluateAll(items => items.map(i => i.className))
check('status line shows refused, waiting and new', ['is-refused', 'is-waiting', 'is-new'].every(k => kinds.some(c => c.includes(k))), kinds.join(' / '))
const statusHeight = (await status.boundingBox())?.height ?? 999
check('status line stays one compact line at 1440', statusHeight <= 32, `${statusHeight}px`)
await status.locator('button.dismiss').first().click()
check('dismiss hides the new notice', await status.locator('li.is-new').count() === 0)
await open('/?range=30d')
check('dismissal survives a reload', await status.locator('li.is-new').count() === 0)

// 8. Edge cases: two machines get the spine, one machine gets a one-row table, empty fixture.
const [a, b] = bySpend
const ids = (names: string[]) => names.map(n => rows.find(r => r.device === n)!.deviceId).join(',')
await open(`/?range=30d&devices=${ids([a!, b!])}`)
check('two machines show the spine', await page.locator('table.board').count() === 0 && await page.locator('.spine, [class*="spine"]').count() > 0)
await page.screenshot({ path: `${OUT}/after-two-machines.png`, fullPage: true })
await open(`/?range=30d&devices=${ids([a!])}`)
check('one machine shows a one-row table', await page.locator('table.board tbody tr').count() === 1)
await page.screenshot({ path: `${OUT}/after-one-machine.png`, fullPage: true })
await page.goto(`${BASE}/?fixture=empty`)
await page.waitForLoadState('networkidle')
check('empty fixture shows the empty state', await page.locator('table.board').count() === 0 && await page.locator('.stats .total').count() === 0)
await page.screenshot({ path: `${OUT}/after-empty.png`, fullPage: true })

await browser.close()
await writeFile(`${OUT}/report.json`, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2))
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed. Report: ${OUT}/report.json`)
process.exit(failed.length > 0 ? 1 : 0)

/**
 * One-time compaction. Rebuilds telemetry.event holding only allowlisted names with projected
 * attrs, after rolling every complete day it is about to discard into the daily summaries.
 *
 * Rerunnable: every step is guarded, and the copy is per-day with `on conflict do nothing`, so
 * an interrupted run resumes rather than duplicating. Nothing is dropped until the rebuilt
 * table is in place and has been counted.
 *
 * Run with: bun --env-file=.env.local scripts/compact-events.ts
 */
import { neon } from '@neondatabase/serverless'
import { EVENT_ATTR_ALLOWLIST } from '../server/utils/otlp'
import { buildDayRollup } from '../server/utils/rollup'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run `vercel env pull .env.local` first.')
  process.exit(1)
}

const RAW_KEEP_DAYS = Number(process.env.RAW_RETENTION_DAYS ?? 7)
const sql = neon(url)
const names = Object.keys(EVENT_ATTR_ALLOWLIST)

/** The attrs projection, generated from the same allowlist ingest filters on. */
function attrsProjection(): string {
  const arms = Object.entries(EVENT_ATTR_ALLOWLIST)
    .filter(([, keys]) => keys.length > 0)
    .map(([name, keys]) => {
      const pairs = keys.map(key => `'${key}', attrs->>'${key}'`).join(', ')
      return `when '${name}' then jsonb_strip_nulls(jsonb_build_object(${pairs}))`
    })
  return `case name ${arms.join(' ')} else '{}'::jsonb end`
}

async function sizes(label: string): Promise<void> {
  const rows = await sql.query(`
    select relname as table,
           pg_size_pretty(pg_total_relation_size(c.oid)) as total
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'telemetry' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc`, [])
  const total = await sql.query('select pg_size_pretty(pg_database_size(current_database())) as size', [])
  console.log(`\n${label}: database ${total[0]!.size}`)
  for (const row of rows) console.log(`  ${String(row.table).padEnd(22)} ${row.total}`)
}

async function step(label: string, run: () => Promise<unknown>): Promise<void> {
  process.stdout.write(`${label} ... `)
  const started = Date.now()
  await run()
  console.log(`done (${Math.round((Date.now() - started) / 1000)}s)`)
}

await sizes('before')

// Every complete day still in raw, oldest first. Rolling up before anything is deleted is what
// preserves twelve days of history through a rebuild that keeps only the last few days raw.
const dayRows = await sql.query(
  `select distinct (ts at time zone 'utc')::date::text as day from telemetry.event
   union select distinct (ts at time zone 'utc')::date::text from telemetry.metric_point
   order by 1`, [])
const days = dayRows.map(row => String(row.day))
console.log(`\nrolling up ${days.length} days: ${days[0]} to ${days[days.length - 1]}`)

for (const day of days) {
  await step(`  roll ${day}`, async () => {
    for (const statement of buildDayRollup(day)) await sql.query(statement.text, statement.params)
  })
}

// Freeing the largest index first buys the headroom the copy needs; it is recreated on the
// rebuilt table at the end.
await step('\ndrop event_name_ts_idx', () => sql.query('drop index if exists telemetry.event_name_ts_idx', []))

await step('create event_compact', async () => {
  await sql.query('create table if not exists telemetry.event_compact (like telemetry.event including defaults)', [])
  await sql.query(`do $do$ begin
    if not exists (select 1 from pg_constraint where conname = 'event_compact_pkey')
    then alter table telemetry.event_compact add primary key (dedupe_key); end if; end $do$`, [])
})

const keepFrom = new Date(Date.now() - RAW_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
const copyDays = days.filter(day => day >= keepFrom)
console.log(`\ncopying ${copyDays.length} days of allowlisted rows (${names.length} names, attrs projected)`)

for (const day of copyDays) {
  await step(`  copy ${day}`, () => sql.query(`
    insert into telemetry.event_compact (dedupe_key, ts, device_id, session_id, name, model, duration_ms, attrs)
    select dedupe_key, ts, device_id, session_id, name, model, duration_ms, ${attrsProjection()}
    from telemetry.event
    where name = any($1::text[])
      and ts >= ($2::date)::timestamp at time zone 'utc'
      and ts < ($2::date + 1)::timestamp at time zone 'utc'
    on conflict (dedupe_key) do nothing`, [names, day]))
}

const copied = await sql.query('select count(*)::int as n from telemetry.event_compact', [])
console.log(`\nevent_compact holds ${copied[0]!.n} rows`)
if (Number(copied[0]!.n) === 0) {
  console.error('refusing to swap in an empty table')
  process.exit(1)
}

// One transaction so ingest blocks on a lock for milliseconds rather than finding no
// telemetry.event at all. The drop is separate: if it fails we are still serving.
//
// The old index has to be renamed out of the way first. Renaming a table does not rename its
// indexes, so event_pkey stays attached to the old table and would collide.
await step('swap event_compact into place', () => sql.transaction([
  sql.query('alter index telemetry.event_pkey rename to event_old_pkey', []),
  sql.query('alter table telemetry.event rename to event_old', []),
  sql.query('alter table telemetry.event_compact rename to event', []),
  sql.query('alter index telemetry.event_compact_pkey rename to event_pkey', [])
]))

await step('recreate constraints and indexes', async () => {
  for (const statement of [
    `alter table telemetry.event add constraint event_device_id_fkey
       foreign key (device_id) references telemetry.device (id) on delete cascade`,
    'create index if not exists event_name_ts_idx on telemetry.event (name, ts desc)',
    'create index if not exists event_device_idx on telemetry.event (device_id)',
    'create index if not exists event_ts_brin_idx on telemetry.event using brin (ts) with (pages_per_range = 32)',
    'alter table telemetry.event set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02)'
  ]) await sql.query(statement, [])
})

await step('drop event_old', () => sql.query('drop table if exists telemetry.event_old', []))

await step('project metric_point attrs and prune', async () => {
  await sql.query(`update telemetry.metric_point set attrs = jsonb_strip_nulls(jsonb_build_object(
      'type', attrs->>'type', 'decision', attrs->>'decision'))
    where attrs <> jsonb_strip_nulls(jsonb_build_object(
      'type', attrs->>'type', 'decision', attrs->>'decision'))`, [])
  await sql.query('delete from telemetry.metric_point where ts < now() - make_interval(days => $1::int)', [RAW_KEEP_DAYS])
})

// Reclamation, not correctness: autovacuum gets there on its own, and VACUUM cannot run
// inside a transaction block, which the HTTP driver may impose.
await step('vacuum', async () => {
  for (const table of ['telemetry.event', 'telemetry.metric_point']) {
    try {
      await sql.query(`vacuum (analyze) ${table}`, [])
    } catch (error) {
      console.warn(`\n  skipped vacuum of ${table}: ${(error as Error).message}`)
    }
  }
})

await sizes('after')

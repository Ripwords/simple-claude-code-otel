import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run `vercel env pull .env.local` first.')
  process.exit(1)
}

const sql = neon(url)
const statements = readFileSync('server/database/schema.sql', 'utf8')
  .split(';')
  .map(s => s.trim())
  .filter(Boolean)

for (const statement of statements) {
  await sql.query(statement)
}

const tables = await sql`
  select table_name from information_schema.tables
  where table_schema = 'telemetry' order by 1`

console.log(`telemetry schema ready: ${tables.map(t => t.table_name).join(', ')}`)

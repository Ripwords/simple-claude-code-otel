import { neonConfig } from '@neondatabase/serverless'

// The e2e stack (test/e2e/docker-compose.yml) fronts plain Postgres with a proxy that speaks
// Neon's HTTP protocol on plain http. *.localtest.me resolves to 127.0.0.1, so a connection
// string on that host can only ever mean the local stack and never a real Neon endpoint.
const LOCAL_HOST = 'db.localtest.me'

export function routeLocalNeon(): void {
  neonConfig.fetchEndpoint = host => host === LOCAL_HOST ? `http://${host}:4444/sql` : `https://${host}/sql`
}

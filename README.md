# Claude Code telemetry, self-hosted

A dashboard for your own Claude Code usage. One Nuxt app and one Postgres
database, deployed on Vercel. It receives OpenTelemetry directly from Claude Code
and shows you cost, tokens, sessions, tool calls, and errors.

It tells your machines apart. If you run Claude Code on a work laptop and a
personal laptop under one Anthropic account, every panel splits by machine and the
top of the page is built around the gap between two of them.

## How it differs from a collector stack

The usual setup is four containers: an OpenTelemetry Collector, Prometheus, Loki,
and Grafana. This is one Vercel project and one database, and there is nothing to
run at home.

That works because of one measured fact. Claude Code exports its metrics with delta
temporality, so each export carries the increase since the last one rather than a
running total. Every number on the dashboard is a `SUM` over a time window. Nothing
has to reconstruct a counter, so nothing needs Prometheus.
`docs/telemetry-schema.md` records the full wire format, captured off a real session
rather than copied from a doc.

## How a machine proves who it is

Each machine gets its own ingest token, minted in the dashboard. The token is the
identity: the server looks it up and knows which machine is calling before it reads
the payload.

That matters more than it sounds. Claude Code sends no machine identifier of its
own, so the obvious design is to have each machine declare a name in
`OTEL_RESOURCE_ATTRIBUTES`. This project did that first and then removed it, because
a declared name is only as good as the machine declaring it. A typo forked a
machine's history in two, any machine holding the shared token could claim any name,
and a machine that set no name at all vanished into a shared `unknown` bucket.
`docs/design-decision-tokens.md` has the full reasoning.

Because identity is now a server-side id rather than a name on the wire, renaming a
machine in the dashboard keeps every metric it ever sent. Revoking one machine's
token leaves the others alone.

## Deploy it

You need a Vercel account, Bun, and Node 20 or newer.

1. Clone the repository and install dependencies.

	```sh
	git clone git@github.com:Ripwords/simple-claude-code-otel.git
	cd simple-claude-code-otel
	bun install
	```

2. Create the Vercel project and attach a Neon Postgres database. The integration
   sets `DATABASE_URL` for you.

	```sh
	vercel link
	vercel integration add neon
	```

3. Set a dashboard password. `auth:hash` prints both values it generates; add each
   to Vercel and to `.env.local`.

	```sh
	bun run auth:hash
	vercel env add DASHBOARD_PASSWORD_HASH production
	vercel env add SESSION_SECRET production
	vercel env add CRON_SECRET production
	```

4. Create the tables.

	```sh
	vercel env pull .env.local
	bun run db:push
	```

5. Deploy.

	```sh
	vercel deploy --prod
	```

## Add your machines

Open the dashboard, sign in, and add a machine. Name it whatever you will recognise
on a chart. The dashboard shows an ingest token **once**, along with a command to
run. Copy it before you navigate away; if you lose it, rotate the token and get a
new one.

On that machine, run what the dashboard gave you:

```sh
./scripts/setup-device.sh \
  --endpoint https://your-app.vercel.app/api/otlp \
  --token <the token the dashboard showed you>
```

Then do the same on your second machine with its own token. Never reuse one token on
two machines; they would report as a single machine and you would lose exactly the
distinction this project exists to give you.

The script writes a telemetry block into `~/.claude/settings.json` and keeps
everything else in the file, saving the previous version alongside it. Start a new
Claude Code session for the change to take effect.

### Setting it up by hand

The script only writes this:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://your-app.vercel.app/api/otlp",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <the token>"
  }
}
```

## Managing machines

Renaming a machine keeps its whole history, because the name is a label rather than
the identity.

Rotating a token kills the old one immediately and keeps the history. Do this if a
token leaks, or if you lost it before copying it.

Revoking a token stops that machine reporting and keeps everything it already sent.
Its spend still appears in every chart, because the money was real.

Deleting a machine destroys all of its telemetry. That one cascades and does not come
back.

## What it stores, and what it does not

Prompts and assistant responses arrive as the literal string `<REDACTED>`. Claude
Code only sends the real text when you set `OTEL_LOG_USER_PROMPTS=1` or
`OTEL_LOG_ASSISTANT_RESPONSES=1`, and this project never asks you to.

Your account email does arrive, attached to each session. It is stored once per
session rather than on every row.

Rows older than `RETENTION_DAYS` (90 by default) are deleted by a daily cron at
04:00 UTC. Noisy hook and plugin events are deleted after 30 days regardless. A
machine's own row is retired only once it is revoked or was never used, and only
after all of its telemetry has aged out.

## Develop locally

```sh
bun run dev
```

Add a machine in the local dashboard and point a real Claude Code session at
`http://localhost:3000/api/otlp` to send it traffic. Lower
`OTEL_METRIC_EXPORT_INTERVAL` to `10000` while you are working, or you will wait a
minute between exports.

```sh
bun run lint
bun run typecheck
bun run test
```

## Design notes

- `docs/telemetry-schema.md` is the measured wire format: every metric, every event,
  every attribute, and what Claude Code does and does not tell you about the machine.
- `docs/design-decision-tokens.md` explains why device identity lives in the
  credential rather than the payload.
- `docs/design-decision.md` explains the storage schema and what was rejected.
- `docs/design-a.md` and `docs/design-b.md` are the two schemas explored before the
  shipped one was picked.
- `docs/neon-auth-notes.md` is a survey of Neon Auth, which this project evaluated
  and did not adopt. It records how to close the open sign-up that Neon Auth ships
  with, which matters if you ever enable it.

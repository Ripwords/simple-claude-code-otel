# Claude Code telemetry, self-hosted

A dashboard for your own Claude Code usage. One Nuxt app and one Postgres
database, deployed on Vercel. It receives OpenTelemetry directly from Claude Code
and shows you cost, tokens, sessions, tool calls, and errors.

It tells your machines apart. If you run Claude Code on a work laptop and a
personal laptop under one Anthropic account, every panel splits by device and the
top of the page compares the two side by side.

## How it differs from a collector stack

The usual setup is four containers: an OpenTelemetry Collector, Prometheus, Loki,
and Grafana. This is one Vercel project and one database, and there is nothing to
run at home.

That works because of one measured fact. Claude Code exports its metrics with
delta temporality, so each export carries the increase since the last one rather
than a running total. Every number on the dashboard is a `SUM` over a time window.
Nothing has to reconstruct a counter, so nothing needs Prometheus.
`docs/telemetry-schema.md` records the full wire format, captured off a real
session rather than copied from a doc.

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

3. Generate a token that your machines will use to authenticate, and set it in all
   three environments.

	```sh
	openssl rand -hex 24
	vercel env add INGEST_TOKEN production
	vercel env add INGEST_TOKEN preview
	vercel env add INGEST_TOKEN development
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

Note the deployment URL and the token. Each machine needs both.

## Point a machine at it

Run this on each machine, with a different `--device` name each time. The name is
the only thing that tells your machines apart, so pick labels you will recognise
on a chart.

```sh
./scripts/setup-device.sh \
  --device work-laptop \
  --endpoint https://your-app.vercel.app/api/otlp \
  --token <your INGEST_TOKEN>
```

On the other machine:

```sh
./scripts/setup-device.sh \
  --device personal-mac \
  --endpoint https://your-app.vercel.app/api/otlp \
  --token <your INGEST_TOKEN>
```

The script writes a telemetry block into `~/.claude/settings.json` and keeps
everything else in the file. It saves the previous version to
`~/.claude/settings.json.bak`. Start a new Claude Code session for the change to
take effect.

To relabel a machine later, run the script again with a new `--device`. Data
already stored keeps the old label, so the chart shows both names until the old
one ages out.

### Setting it up by hand

The script only writes this, so you can paste it into `~/.claude/settings.json`
yourself:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://your-app.vercel.app/api/otlp",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <your INGEST_TOKEN>",
    "OTEL_RESOURCE_ATTRIBUTES": "device.name=work-laptop"
  }
}
```

Claude Code sends no machine identifier of its own. There is no `host.name` and no
device id on the wire, and `service.name` is the constant `claude-code`, so
`OTEL_RESOURCE_ATTRIBUTES` is the only way to tell two machines apart.

## What it stores, and what it does not

Prompts and assistant responses arrive as the literal string `<REDACTED>`. Claude
Code only sends the real text when you set `OTEL_LOG_USER_PROMPTS=1` or
`OTEL_LOG_ASSISTANT_RESPONSES=1`, and this project never asks you to.

Your account email does arrive, attached to each session. It is stored once per
session rather than on every row. The database is yours and the deployment is
private by default.

Rows older than `RETENTION_DAYS` (90 by default) are deleted by a daily cron at
04:00 UTC. Noisy hook and plugin events are deleted after 30 days regardless.

## Develop locally

```sh
bun run dev
```

Point a machine at `http://localhost:3000/api/otlp` to send it real traffic.
Lower `OTEL_METRIC_EXPORT_INTERVAL` to `10000` while you are working, or you will
wait a minute between exports.

```sh
bun run lint
bun run typecheck
bun run test
```

## Design notes

- `docs/telemetry-schema.md` is the measured wire format: every metric, every
  event, every attribute, and where device identity comes from.
- `docs/design-decision.md` explains the storage schema and what was rejected.
- `docs/design-a.md` and `docs/design-b.md` are the two designs that were explored
  before the shipped one was picked.

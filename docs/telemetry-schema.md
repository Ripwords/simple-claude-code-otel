# Claude Code OTLP schema (measured, not guessed)

Captured from Claude Code `2.1.247` on 2026-08-27 by pointing a real session at a
local OTLP/HTTP JSON sink. Every fact below came off the wire.

## Transport

`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` works. Claude Code POSTs to
`$OTEL_EXPORTER_OTLP_ENDPOINT/v1/metrics` and `/v1/logs` with a JSON body in OTLP
JSON encoding. `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <token>"` arrives
verbatim as the `authorization` request header.

## Aggregation temporality

All six metrics export with `aggregationTemporality: 1` (DELTA) **by default**.
No `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` is needed. Every datapoint
is an increment since the last export, so ingest is an append and every dashboard
query is a `SUM` over a time window. There is no counter-reset arithmetic anywhere
in this project, and that is why it needs no Prometheus.

## Device identity

Claude Code emits **no** `host.name`, `host.id`, or any other per-machine
attribute. `service.name` is the constant `claude-code`. Two machines on one
account are indistinguishable unless you tag them yourself.

`OTEL_RESOURCE_ATTRIBUTES="device.name=work-mac"` is honoured. The pair lands in
`resourceMetrics[].resource.attributes` and `resourceLogs[].resource.attributes`,
and Claude Code also copies it onto every individual datapoint and log record.
Reading it off the resource is sufficient.

Default resource attributes: `service.name=claude-code`, `service.version`,
`os.type`, `os.version`, `host.arch`.

## Attributes on every datapoint and log record

`session.id`, `user.id`, `user.email`, `user.account_uuid`, `user.account_id`,
`organization.id`, `terminal.type`.

## Metrics

| name | unit | attributes beyond the common set |
|---|---|---|
| `claude_code.session.count` | (none) | `start_type` |
| `claude_code.cost.usage` | `USD` | `model`, `query_source` |
| `claude_code.token.usage` | `tokens` | `model`, `query_source`, `type` (input/output/cacheRead/cacheCreation) |
| `claude_code.lines_of_code.count` | `lines` | `model`, `type` (added/removed) |
| `claude_code.active_time.total` | `s` | `type` |
| `claude_code.code_edit_tool.decision` | (none) | `tool_name`, `decision`, `source`, `language` |

All are monotonic sums carrying `asDouble`.

## Events

Log records carry the prefixed name in `body.stringValue`
(`claude_code.api_request`) and the bare name in the `event.name` attribute
(`api_request`). Every record has `event.name`, `event.timestamp`,
`event.sequence`.

| event | attributes |
|---|---|
| `api_request` | `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`, `cost_usd_micros`, `duration_ms`, `request_id`, `client_request_id`, `speed`, `query_source`, `prompt.id` |
| `api_error` | `model`, `error`, `status_code`, `duration_ms`, `attempt` |
| `tool_result` | `tool_name`, `success`, `duration_ms`, `tool_use_id`, `tool_input_size_bytes`, `tool_result_size_bytes`, `prompt.id` |
| `tool_decision` | `tool_name`, `decision`, `source`, `tool_source`, `tool_use_id` |
| `user_prompt` | `prompt_length`, `prompt`, `message.uuid`, `prompt.id` |
| `assistant_response` | `response_length`, `response`, `model`, `request_id`, `message.uuid` |
| `hook_execution_start` / `hook_execution_complete` | `hook_event`, `hook_name`, `num_hooks`, `hook_source` |
| `hook_registered` | `hook_event`, `hook_type`, `hook_source` |
| `plugin_loaded` | plugin identity |
| `mcp_server_connection` | server identity and status |

`prompt` and `response` arrive as the literal string `<REDACTED>` unless
`OTEL_LOG_USER_PROMPTS=1` / `OTEL_LOG_ASSISTANT_RESPONSES=1` are set.

The tool events key on `tool_name`. Anthropic's older published doc said `name`;
that is stale for this version.

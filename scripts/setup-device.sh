#!/usr/bin/env bash
# Point this machine's Claude Code at a telemetry dashboard.
# Add the machine in the dashboard first; it gives you the token.
set -euo pipefail

usage() {
  cat <<USAGE
usage: setup-device.sh --endpoint <url> --token <token>

  --endpoint  the dashboard's OTLP URL, e.g. https://your-app.vercel.app/api/otlp
  --token     the token the dashboard showed when you added this machine.
              The token is what identifies the machine, so use a different
              one on each machine and never share a token between two.

Writes the telemetry block into ~/.claude/settings.json, preserving everything
else in the file. The previous version is saved alongside it as a .bak.
USAGE
  exit 1
}

ENDPOINT="" TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$ENDPOINT" ] && [ -n "$TOKEN" ] || usage

command -v jq >/dev/null || { echo "jq is required. brew install jq" >&2; exit 1; }

SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak"

jq --arg endpoint "$ENDPOINT" --arg token "$TOKEN" '
  .env = ((.env // {}) + {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": $endpoint,
    "OTEL_EXPORTER_OTLP_HEADERS": ("Authorization=Bearer " + $token)
  })
' "$SETTINGS.bak" > "$SETTINGS"

echo "This machine now reports to $ENDPOINT"
echo "Previous settings saved to $SETTINGS.bak"
echo "Start a new Claude Code session for it to take effect."

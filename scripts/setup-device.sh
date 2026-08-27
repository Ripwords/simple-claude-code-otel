#!/usr/bin/env bash
# Point this machine's Claude Code at a telemetry dashboard, tagged with a device name.
set -euo pipefail

usage() {
  cat <<USAGE
usage: setup-device.sh --device <name> --endpoint <url> --token <token>

  --device    label for this machine, e.g. "work-laptop" or "personal-mac".
              This is the only thing that tells your two machines apart.
  --endpoint  base URL of the deployed dashboard, e.g. https://your-app.vercel.app/api/otlp
  --token     the INGEST_TOKEN the dashboard was deployed with.

Writes the telemetry block into ~/.claude/settings.json, preserving everything
else in the file. Re-running with a different device name just relabels this
machine.
USAGE
  exit 1
}

DEVICE="" ENDPOINT="" TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$DEVICE" ] && [ -n "$ENDPOINT" ] && [ -n "$TOKEN" ] || usage

command -v jq >/dev/null || { echo "jq is required. brew install jq" >&2; exit 1; }

SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak"

jq --arg device "$DEVICE" --arg endpoint "$ENDPOINT" --arg token "$TOKEN" '
  .env = ((.env // {}) + {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": $endpoint,
    "OTEL_EXPORTER_OTLP_HEADERS": ("Authorization=Bearer " + $token),
    "OTEL_RESOURCE_ATTRIBUTES": ("device.name=" + $device)
  })
' "$SETTINGS.bak" > "$SETTINGS"

echo "This machine now reports as device.name=$DEVICE"
echo "Previous settings saved to $SETTINGS.bak"
echo "Start a new Claude Code session for it to take effect."

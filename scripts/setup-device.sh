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

Run it straight off the repository, with no clone:

  curl -fsSL https://raw.githubusercontent.com/Ripwords/simple-claude-code-otel/main/scripts/setup-device.sh \\
    | bash -s -- --endpoint <url> --token <token>

Writes the telemetry block into ~/.claude/settings.json, preserving everything
else in the file. The previous version is saved alongside it as a .bak.
USAGE
  exit 1
}

ENDPOINT="" TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --endpoint) [ $# -ge 2 ] || usage; ENDPOINT="$2"; shift 2 ;;
    --token) [ $# -ge 2 ] || usage; TOKEN="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[ -n "$ENDPOINT" ] && [ -n "$TOKEN" ] || usage

case "$ENDPOINT" in
  http://*|https://*) ;;
  *) echo "--endpoint must be a URL, e.g. https://your-app.vercel.app/api/otlp" >&2; exit 1 ;;
esac

SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak"

# The merge needs a JSON parser, and the machine being set up has whichever it
# happens to have. Any one of these three is enough, so none of them is a
# prerequisite the way jq alone once was.
merge_with_jq() {
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
}

# Reads the file itself rather than taking it on argv, so a large settings.json
# cannot hit an argument-length limit.
MERGE_JS='
const fs = require("fs")
// node -e puts no script path in argv, so the arguments start at 1, not 2.
const [source, target, endpoint, token] = process.argv.slice(1)
const settings = JSON.parse(fs.readFileSync(source, "utf8"))
settings.env = Object.assign({}, settings.env, {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer " + token
})
fs.writeFileSync(target, JSON.stringify(settings, null, 2) + "\n")
'

MERGE_PY='
import json, sys
source, target, endpoint, token = sys.argv[1:5]
with open(source) as handle:
    settings = json.load(handle)
settings.setdefault("env", {}).update({
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": endpoint,
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer " + token,
})
with open(target, "w") as handle:
    json.dump(settings, handle, indent=2)
    handle.write("\n")
'

if command -v jq >/dev/null 2>&1; then
  merge_with_jq
elif command -v node >/dev/null 2>&1; then
  node -e "$MERGE_JS" "$SETTINGS.bak" "$SETTINGS" "$ENDPOINT" "$TOKEN"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c "$MERGE_PY" "$SETTINGS.bak" "$SETTINGS" "$ENDPOINT" "$TOKEN"
else
  echo "This needs jq, node, or python3 to edit settings.json, and found none." >&2
  echo "Install one of them, or write the block by hand: see the project README." >&2
  exit 1
fi

echo "This machine now reports to $ENDPOINT"
echo "Previous settings saved to $SETTINGS.bak"
echo "Start a new Claude Code session for it to take effect."
echo "The Claude desktop app reads the same file, so its local sessions report too."

#!/bin/sh
# apps/studio/v1 is an AGPL-3.0 upstream submodule — we do NOT modify it.
# This script (mounted into the odysseus container by docker-compose.yml)
# runs as the entrypoint's final command and:
#   1. ensures first-time setup (idempotent),
#   2. registers the INTEL.DOM.GOB MCP server by DEFAULT (if not present),
#   3. starts the Odysseus web app.
#
# The Studio connects to the platform ONLY via this MCP server
# (mcp:4100/mcp). Running it by default means a fresh deploy already has
# the INTEL.DOM.GOB tools available in Odysseus' MCP browser / agents.

set -e

MCP_BIN="/app/scripts/odysseus-mcp"
MCP_NAME="${INTEL_MCP_NAME:-intel-dom-gob}"
MCP_URL="${INTEL_MCP_URL:-http://mcp:4100/mcp}"

# 1. First-time setup (idempotent; safe to re-run).
python /app/setup.py || true

# 2. Register our MCP server by default (idempotent: skip if already present).
if [ -x "$MCP_BIN" ]; then
  if "$MCP_BIN" list 2>/dev/null | grep -q "\"name\": \"${MCP_NAME}\""; then
    echo ">> [studio] MCP '${MCP_NAME}' already registered — skipping."
  else
    echo ">> [studio] Registering default MCP server '${MCP_NAME}' -> ${MCP_URL}"
    "$MCP_BIN" add --name "${MCP_NAME}" --transport sse --url "${MCP_URL}" \
      || echo ">> [studio] WARN: MCP registration failed (will retry next boot)."
  fi
else
  echo ">> [studio] WARN: ${MCP_BIN} not found — skipping MCP registration."
fi

# 2b. Seed a default email account (optional). When SMTP/IMAP env vars are
#     present we write the legacy flat keys into settings.json; Odysseus'
#     built-in migration (_migrate_seed_email_account) then creates the
#     "Default" account on first boot and the "SMTP/IMAP not configured"
#     warnings disappear. Idempotent and non-destructive to other keys.
SEED_EMAIL="${STUDIO_EMAIL_SMTP_HOST:-}"
if [ -n "$SEED_EMAIL" ]; then
  SETTINGS_FILE="${ODYSSEUS_DATA_DIR:-/app/data}/settings.json"
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  python3 - "$SETTINGS_FILE" <<'PY'
import json, os, sys
path = sys.argv[1]
keys = {
    "smtp_host":     os.environ.get("STUDIO_EMAIL_SMTP_HOST", ""),
    "smtp_port":     int(os.environ.get("STUDIO_EMAIL_SMTP_PORT", "465") or 465),
    "smtp_security": os.environ.get("STUDIO_EMAIL_SMTP_SECURITY", ""),
    "smtp_user":     os.environ.get("STUDIO_EMAIL_SMTP_USER", ""),
    "smtp_password": os.environ.get("STUDIO_EMAIL_SMTP_PASSWORD", ""),
    "imap_host":     os.environ.get("STUDIO_EMAIL_IMAP_HOST", ""),
    "imap_port":     int(os.environ.get("STUDIO_EMAIL_IMAP_PORT", "993") or 993),
    "imap_user":     os.environ.get("STUDIO_EMAIL_IMAP_USER", ""),
    "imap_password": os.environ.get("STUDIO_EMAIL_IMAP_PASSWORD", ""),
    "imap_starttls": os.environ.get("STUDIO_EMAIL_IMAP_STARTTLS", "true").lower() == "true",
    "email_from":    os.environ.get("STUDIO_EMAIL_FROM", ""),
}
data = {}
if os.path.exists(path):
    try:
        data = json.load(open(path, encoding="utf-8"))
    except Exception:
        data = {}
data.update({k: v for k, v in keys.items() if v != "" and v is not False})
# Always ensure imap_starttls and ports persist even when blank.
data["imap_starttls"] = keys["imap_starttls"]
data["smtp_port"] = keys["smtp_port"]
data["imap_port"] = keys["imap_port"]
json.dump(data, open(path, "w", encoding="utf-8"), indent=2)
print(">> [studio] Wrote email settings into", path)
PY
else
  echo ">> [studio] No STUDIO_EMAIL_SMTP_HOST set — skipping email seed."
fi

# 3. Start the app (replaces the default CMD).
exec uvicorn app:app --host 0.0.0.0 --port 7000

#!/usr/bin/env bash
#
# scripts/studio-up.sh
#
# Runs the Studio (v1 — Odysseus workspace) as part of the INTEL.DOM.GOB stack.
#
# The Studio is an AGPL-3.0 upstream project (git submodule at apps/studio/v1)
# that connects to the platform ONLY through the MCP server. This script:
#   1. Ensures the full platform stack is up (so the MCP server exists).
#   2. Starts just the Studio services (odysseus + its own chromadb/searxng/ntfy).
#   3. Waits for Odysseus to become healthy.
#
# The INTEL.DOM.GOB MCP server is registered automatically on boot by the
# on-boot hook (scripts/studio-onboot.sh, mounted into the odysseus container),
# so no separate seed step is needed here.
#
# Usage:
#   ./scripts/studio-up.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/banner.sh"
cd "$ROOT_DIR"

DOMAIN="${DOMAIN:-localhost}"

show_banner "studio up"

# Studio services defined in the single docker-compose.yml.
STUDIO_SERVICES="odysseus studio-chromadb studio-searxng studio-ntfy"

# Bring the rest of the platform up first (MCP server must exist for the seed).
if ! docker compose ps --format '{{.Name}} {{.State}}' 2>/dev/null | grep -qE "mcp.*(running|healthy)"; then
  echo "==> Platform not running — starting full stack first (this includes the MCP server)..."
  docker compose up -d --remove-orphans
  echo "==> Waiting for the stack to become healthy..."
  sleep 8
else
  # Platform already up: just ensure the Studio services are running.
  echo "==> Starting Studio services..."
  # shellcheck disable=SC2086
  docker compose up -d --remove-orphans ${STUDIO_SERVICES}
fi

echo "==> Waiting for Odysseus to become healthy..."
for i in $(seq 1 60); do
  if docker compose ps --format '{{.Name}} {{.State}}' 2>/dev/null | grep -qE "odysseus.*healthy"; then
    break
  fi
  sleep 3
done

if ! docker compose ps --format '{{.Name}} {{.State}}' 2>/dev/null | grep -qE "odysseus.*(running|healthy)"; then
  echo "!! Odysseus did not become healthy. Check: docker compose logs odysseus"
  exit 1
fi

echo "==> Studio is up at: http://studio.${DOMAIN}"
echo "==> INTEL.DOM.GOB MCP is registered automatically on boot."
echo "==> Open studio.${DOMAIN} in your browser."

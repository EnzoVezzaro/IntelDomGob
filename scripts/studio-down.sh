#!/usr/bin/env bash
#
# scripts/studio-down.sh
#
# Stops the Studio (v1 — Odysseus workspace) services only, leaving the rest of
# the INTEL.DOM.GOB platform running.
#
# Usage:
#   ./scripts/studio-down.sh          # stop studio services
#   ./scripts/studio-down.sh --all    # also stop the rest of the platform

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/banner.sh"
cd "$ROOT_DIR"

STOP_ALL=0
for arg in "$@"; do
  case "$arg" in
    --all) STOP_ALL=1 ;;
    *) echo "unknown arg: $arg" >&2 ;;
  esac
done

show_banner "studio down"

STUDIO_SERVICES="odysseus studio-chromadb studio-searxng studio-ntfy"

if [ "$STOP_ALL" -eq 1 ]; then
  echo "==> Stopping the entire platform..."
  docker compose down
  echo "==> Platform stopped."
else
  echo "==> Stopping Studio services only (platform stays up)..."
  # shellcheck disable=SC2086
  docker compose stop ${STUDIO_SERVICES}
  # Remove the studio volumes only when explicitly tearing down everything.
  echo "==> Studio stopped. Platform (api, mcp, ...) is still running."
fi

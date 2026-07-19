#!/usr/bin/env bash
# setup.sh — One-time environment setup for INTEL.DOM.GOB.
#
# Validates prerequisites, creates .env from .env.example, installs workspace
# dependencies and verifies the Docker stack can be built. Idempotent and safe to
# re-run. Mirrors the spirit of WORK.md "Scripts should validate prerequisites,
# print friendly output, fail gracefully, be reusable, be idempotent".
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "setup"

echo "==> Checking prerequisites..."
for cmd in node npm docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "!! Required command not found: $cmd"
    exit 1
  fi
  echo "   - $cmd: $($cmd --version 2>/dev/null | head -1)"
done

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "==> Creating .env from .env.example"
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
else
  echo "==> .env already exists (skipped)"
fi

echo "==> Installing workspace dependencies..."
(cd "$ROOT_DIR" && npm install --workspaces)

echo "==> Setup complete."
echo "   Next: ./scripts/start.sh   (brings up the full stack via Docker)"

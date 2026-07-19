#!/usr/bin/env bash
# update.sh — Actualiza dependencias del monorepo.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "update"
echo "==> Actualizando dependencias (npm workspaces)..."
npm install --workspaces
npm update --workspaces
echo "==> Dependencias actualizadas."

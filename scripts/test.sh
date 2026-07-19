#!/usr/bin/env bash
# test.sh — Ejecuta las pruebas de todos los workspaces.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "test"
echo "==> Ejecutando pruebas..."
npm run test --workspaces --if-present
echo "==> Pruebas completas."

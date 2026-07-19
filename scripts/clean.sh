#!/usr/bin/env bash
# clean.sh — Limpia artefactos de build y node_modules.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "clean"
echo "==> Eliminando dist/ y node_modules..."
find "$ROOT_DIR" -type d -name dist -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
find "$ROOT_DIR" -type d -name node_modules -exec rm -rf {} + 2>/dev/null || true
echo "==> Limpieza completa."

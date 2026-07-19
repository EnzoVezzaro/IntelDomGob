#!/usr/bin/env bash
# format.sh — Formatea el código (prettier si está disponible, si no, no-op).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "format"
if command -v npx >/dev/null 2>&1 && [ -f "$ROOT_DIR/node_modules/.bin/prettier" ]; then
  npx prettier --write "packages/**/*.ts" "providers/**/*.ts" "services/**/*.ts" "apps/**/*.ts" "apps/**/*.tsx"
else
  echo "==> Prettier no instalado; omitiendo formato."
fi

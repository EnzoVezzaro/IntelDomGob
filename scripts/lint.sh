#!/usr/bin/env bash
# lint.sh — Typecheck de todos los workspaces.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "lint"
echo "==> Typecheck (tsc --noEmit) de todos los paquetes..."
npm run typecheck --workspaces --if-present
echo "==> Lint completo."

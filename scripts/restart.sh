#!/usr/bin/env bash
# restart.sh — Reinicia toda la plataforma.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "restart"
cd "$ROOT_DIR"
docker compose down
docker compose up -d
echo "==> Plataforma reiniciada."

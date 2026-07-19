#!/usr/bin/env bash
# stop.sh — Detiene toda la plataforma.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "stop"
cd "$ROOT_DIR"
docker compose down
echo "==> Plataforma detenida."

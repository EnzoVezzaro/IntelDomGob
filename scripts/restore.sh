#!/usr/bin/env bash
# restore.sh — Restaura un respaldo de PostgreSQL.
# Uso: scripts/restore.sh backups/YYYYMMDD-HHMMSS/postgres.sql
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "restore"

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "!! Uso: scripts/restore.sh <ruta/postgres.sql>"
  exit 1
fi
echo "==> Restaurando PostgreSQL desde $SRC ..."
docker compose exec -T postgres psql -U "${POSTGRES_USER:-intel}" "${POSTGRES_DB:-inteldomgob}" < "$SRC"
echo "==> Restauración completa."

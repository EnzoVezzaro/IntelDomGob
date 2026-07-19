#!/usr/bin/env bash
# backup.sh — Respalda volúmenes persistentes (postgres, dragonfly, caddy).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "backup"
BACKUP_DIR="${ROOT_DIR}/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "==> Respaldando PostgreSQL..."
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-intel}" "${POSTGRES_DB:-inteldomgob}" > "$BACKUP_DIR/postgres.sql" 2>/dev/null || echo "!! PostgreSQL no disponible"

echo "==> Respaldando volúmenes de datos..."
docker run --rm -v "${COMPOSE_PROJECT_NAME:-inteldomgob}_postgres_data":/data -v "$BACKUP_DIR":/backup alpine sh -c "cd /data && tar czf /backup/postgres_data.tgz ." 2>/dev/null || true
docker run --rm -v "${COMPOSE_PROJECT_NAME:-inteldomgob}_dragonfly_data":/data -v "$BACKUP_DIR":/backup alpine sh -c "cd /data && tar czf /backup/dragonfly_data.tgz ." 2>/dev/null || true

echo "==> Backup en: $BACKUP_DIR"

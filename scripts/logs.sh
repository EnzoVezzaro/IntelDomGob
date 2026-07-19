#!/usr/bin/env bash
# logs.sh — Muestra logs de los servicios (tail -f por defecto).
# Uso: scripts/logs.sh [servicio] [lineas]
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
SERVICE="${1:-}"
if [ -n "$SERVICE" ]; then
  docker compose logs -f "$SERVICE"
else
  docker compose logs -f
fi

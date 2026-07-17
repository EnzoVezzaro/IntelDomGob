#!/usr/bin/env bash
# stop.sh — Detiene INTEL.DOM.GOV RAG (app + SearXNG si está disponible)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/scripts/.intel.pid"
source "$ROOT_DIR/scripts/banner.sh"

show_banner "stop"

# 1. Detener la app por PID guardado
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "==> Deteniendo app (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    # matar procesos hijos (tsx/vite) colgando en el puerto 3000
    pkill -f "tsx server.ts" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
else
  echo "==> No hay PID guardado; limpiando procesos en puerto 3000..."
  pkill -f "tsx server.ts" 2>/dev/null || true
fi

# 2. SearXNG (opcional)
if [ -f "$ROOT_DIR/searxng-docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
  echo "==> Deteniendo SearXNG..."
  docker compose -f "$ROOT_DIR/searxng-docker-compose.yml" down || true
fi

echo "==> Hecho."

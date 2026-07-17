#!/usr/bin/env bash
# start.sh — Arranca INTEL.DOM.GOV RAG (app + SearXNG si está disponible)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/Apps/ChatGobDO"
PID_FILE="$ROOT_DIR/scripts/.intel.pid"
source "$ROOT_DIR/scripts/banner.sh"

show_banner "start"

# 1. SearXNG (opcional, si hay docker compose en la raíz)
if [ -f "$ROOT_DIR/searxng-docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
  echo "==> Levantando SearXNG..."
  docker compose -f "$ROOT_DIR/searxng-docker-compose.yml" up -d || echo "!! No se pudo levantar SearXNG (continuando sin él)"
fi

# 2. Dependencias de la app
if [ ! -d "$APP_DIR/node_modules" ]; then
  echo "==> Instalando dependencias de la app..."
  (cd "$APP_DIR" && npm install)
fi

# 3. Arrancar la app en segundo plano
echo "==> Iniciando servidor en http://0.0.0.0:3000 ..."
(cd "$APP_DIR" && npm run dev) > "$ROOT_DIR/scripts/.intel.log" 2>&1 &
echo $! > "$PID_FILE"

sleep 2
if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "==> App corriendo (PID $(cat "$PID_FILE")). Log: scripts/.intel.log"
  show_endpoints
else
  echo "!! La app falló al arrancar. Revisa scripts/.intel.log"
  exit 1
fi

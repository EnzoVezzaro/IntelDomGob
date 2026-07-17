#!/usr/bin/env bash
# init.sh — Configuración inicial de INTEL.DOM.GOV RAG
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/Apps/ChatGobDO"
source "$ROOT_DIR/scripts/banner.sh"

show_banner "init"

# 1. Node / npm
if ! command -v node >/dev/null 2>&1; then
  echo "!! Node.js no está instalado. Instálalo antes de continuar (https://nodejs.org)."
  exit 1
fi
echo "==> Node: $(node -v) | npm: $(npm -v)"

# 2. Docker (requerido para SearXNG)
if ! command -v docker >/dev/null 2>&1; then
  echo "!! Docker no está instalado. SearXNG (búsqueda web) no funcionará."
  echo "   Instálalo desde https://docs.docker.com/get-docker/ e intenta de nuevo."
else
  echo "==> Docker: $(docker --version)"
fi

# 3. Dependencias de la app
echo "==> Instalando dependencias de la app..."
(cd "$APP_DIR" && npm install)

# 4. Archivo .env de la app (si no existe)
if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Creando .env de la app a partir de .env.example (si existe)..."
  if [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  else
    cat > "$APP_DIR/.env" <<'EOF'
# Configuración de INTEL.DOM.GOV RAG
SEARXNG_URL=http://127.0.0.1:8090
# GEMINI_API_KEY=tu_api_key_aqui
EOF
  fi
  echo "!! Recuerda configurar GEMINI_API_KEY en $APP_DIR/.env"
fi

# 5. SearXNG vía docker compose (opcional)
if [ -f "$ROOT_DIR/searxng-docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
  echo "==> Levantando SearXNG..."
  docker compose -f "$ROOT_DIR/searxng-docker-compose.yml" up -d
fi

echo "==> Init completo. Ejecuta scripts/start.sh para arrancar la app."

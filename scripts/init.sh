#!/usr/bin/env bash
# init.sh — Configuración inicial del entorno de desarrollo.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "init"

echo "==> Node: $(node -v 2>/dev/null || echo 'NO instalado')"
echo "==> npm:  $(npm -v 2>/dev/null || echo 'NO instalado')"
echo "==> Docker: $(docker --version 2>/dev/null || echo 'NO instalado')"

if ! command -v docker >/dev/null 2>&1; then
  echo "!! Docker es requerido para SearXNG y la pila completa."
  exit 1
fi

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "==> Creando .env desde .env.example"
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

echo "==> Instalando dependencias del monorepo (npm workspaces)..."
(cd "$ROOT_DIR" && npm install --workspaces)

echo "==> Init completo. Ejecuta scripts/start.sh para levantar la plataforma."

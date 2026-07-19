#!/usr/bin/env bash
# start.sh — Levanta toda la plataforma INTEL.DOM.GOB con un solo comando.
#
# Desarrollo y producción usan el MISMO docker compose. Solo cambia DOMAIN.
#   docker compose up -d
#
# Después de esto la plataforma está operativa vía subdominios:
#   http://studio.localhost   http://api.localhost
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/banner.sh"

show_banner "start"

if [ ! -f "$ROOT_DIR/.env" ]; then
  echo "==> No se encontró .env; creando desde .env.example"
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

cd "$ROOT_DIR"
echo "==> Levantando la plataforma (docker compose)..."
docker compose up -d

echo ""
echo "==> Esperando a que los servicios estén saludables..."
sleep 5
docker compose ps

echo ""
show_endpoints
echo "==> Listo. Abre studio.${DOMAIN} en tu navegador."

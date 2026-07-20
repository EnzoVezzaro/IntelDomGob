#!/usr/bin/env bash
# deploy.sh — Despliegue de un solo comando.
#
# Flujo:
#   git pull -> build -> docker compose pull -> docker compose up -d -> health
#
# En producción solo se cambia DOMAIN en .env; la pila es idéntica a desarrollo.
# IMPORTANTE: el deploy SIEMPRE usa el compose base (docker-compose.yml) y NUNCA
# aplica docker-compose.override.yml, de modo que docs se sirve como build
# standalone de producción, nunca en modo hot-reload de desarrollo.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "deploy"

# Forzar el archivo base: evita que exista un override de dev en localhost
# contamine el despliegue de producción.
COMPOSE_FILES="-f docker-compose.yml"

echo "==> Pull de la última versión..."
git pull --ff-only || echo "!! git pull falló (continuando)"

echo "==> Actualizando imágenes..."
docker compose $COMPOSE_FILES pull

echo "==> Levantando plataforma..."
docker compose $COMPOSE_FILES up -d --build

echo "==> Health checks..."
for svc in api studio searxng docs; do
  for i in $(seq 1 30); do
    if docker compose ps "$svc" 2>/dev/null | grep -q "healthy\|Up"; then
      echo "  [OK] $svc"
      break
    fi
    sleep 2
  done
done

echo ""
show_endpoints
echo "==> Despliegue completado en https://studio.${DOMAIN}."

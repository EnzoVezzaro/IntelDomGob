#!/usr/bin/env bash
# doctor.sh — Verifica prerrequisitos y salud de la plataforma.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/banner.sh"
show_banner "doctor"

fail=0
check() { if [ "$1" -eq 0 ]; then echo "  [OK]   $2"; else echo "  [FAIL] $2"; fail=1; fi; }

echo "==> Prerrequisitos"
command -v node >/dev/null 2>&1 && check 0 "Node.js $(node -v)" || check 1 "Node.js no instalado"
command -v npm  >/dev/null 2>&1 && check 0 "npm $(npm -v)"      || check 1 "npm no instalado"
command -v docker >/dev/null 2>&1 && check 0 "Docker $(docker --version)" || check 1 "Docker no instalado"
[ -f "$ROOT_DIR/.env" ] && check 0 ".env presente" || check 1 ".env ausente (copia .env.example)"

echo "==> Servicios (docker compose)"
if docker compose ps --format json >/dev/null 2>&1; then
  for svc in caddy api studio searxng postgres dragonfly; do
    if docker compose ps "$svc" 2>/dev/null | grep -q "Up"; then
      check 0 "$svc corriendo"
    else
      check 1 "$svc no está corriendo"
    fi
  done
else
  check 1 "docker compose no disponible"
fi

echo ""
if [ "$fail" -eq 0 ]; then echo "==> Doctor: todo en orden."; else echo "==> Doctor: se encontraron problemas."; fi
exit $fail

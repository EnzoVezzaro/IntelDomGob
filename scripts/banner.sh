#!/usr/bin/env bash
# banner.sh — Logo ASCII + cabecera de presentación compartida por los scripts.
# Uso: source scripts/banner.sh && show_banner "start"

INTEL_LOGO='
 ██╗███╗   ██╗████████╗███████╗██╗        ██████╗  ██████╗ ███╗   ███╗    ██████╗  ██████╗ ██████╗
 ██║████╗  ██║╚══██╔══╝██╔════╝██║        ██╔══██╗██╔═══██╗████╗ ████║   ██╔════╝ ██╔═══██╗██╔══██╗
 ██║██╔██╗ ██║   ██║   █████╗  ██║        ██║  ██║██║   ██║██╔████╔██║   ██║  ███╗██║   ██║██████╔╝
 ██║██║╚██╗██║   ██║   ██╔══╝  ██║        ██║  ██║██║   ██║██║╚██╔╝██║   ██║   ██║██║   ██║██╔══██╗
 ██║██║ ╚████║   ██║   ███████╗███████╗██╗██████╔╝╚██████╔╝██║ ╚═╝ ██║██╗╚██████╔╝╚██████╔╝██████╔╝
 ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝╚═╝╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝  ⚀═════╝ ╚═════╝'

DOMAIN="${DOMAIN:-localhost}"

show_banner() {
  local ACTION="${1:-}"
  echo -e "\033[38;5;202m${INTEL_LOGO}\033[0m"
  echo -e "  \033[1;37mPlataforma de Inteligencia Gubernamental · Estado Dominicano\033[0m"
  echo -e "  \033[2mDeep Research en fuentes oficiales .do · multi-agente · RAG · API-first\033[0m"
  if [ -n "$ACTION" ]; then
    echo -e "  \033[38;5;202m▶ ${ACTION}\033[0m"
  fi
  echo ""
}

show_endpoints() {
  echo -e "  \033[1;37mAplicaciones (via reverse proxy Caddy)\033[0m"
  echo -e "  \033[38;5;202m────────────────────────────────────────────\033[0m"
  printf "  \033[1;36m%-28s\033[0m %s\n" "studio.${DOMAIN}" "Interfaz principal (Studio)"
  printf "  \033[1;36m%-28s\033[0m %s\n" "api.${DOMAIN}"     "API gateway (el producto)"
  printf "  \033[1;36m%-28s\033[0m %s\n" "docs.${DOMAIN}"    "Documentación"
  echo ""
  echo -e "  \033[1;37mAPI (api.${DOMAIN}/v1)\033[0m"
  echo -e "  \033[38;5;202m─────────────────────\033[0m"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "RUTA" "MÉTODO" "DESCRIPCIÓN"
  printf "  \033[38;5;202m%-14s\033[0m %-8s %s\n" "──────────────" "────────" "──────────────────────────────────────"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/health"       "GET"    "Estado del API"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/v1/health"    "GET"    "Estado de la API v1"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/v1/institutions" "GET" "Registro dinámico de instituciones"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/v1/url-tree"  "GET"    "Árbol de URLs de portales"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/v1/query"     "POST"   "Bucle multi-agente: consulta + evidencia"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/v1/chat"      "POST"   "Chat con contexto (Audit Evidence Packet)"
  echo ""
}

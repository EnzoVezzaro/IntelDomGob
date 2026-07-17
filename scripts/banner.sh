#!/usr/bin/env bash
# banner.sh — Logo ASCII + cabecera de presentación compartida por los scripts.
# Uso: source scripts/banner.sh && show_banner

INTEL_LOGO='
 ██╗███╗   ██╗████████╗███████╗██╗        ██████╗  ██████╗ ███╗   ███╗    ██████╗  ██████╗ ██████╗
 ██║████╗  ██║╚══██╔══╝██╔════╝██║        ██╔══██╗██╔═══██╗████╗ ████║   ██╔════╝ ██╔═══██╗██╔══██╗
 ██║██╔██╗ ██║   ██║   █████╗  ██║        ██║  ██║██║   ██║██╔████╔██║   ██║  ███╗██║   ██║██████╔╝
 ██║██║╚██╗██║   ██║   ██╔══╝  ██║        ██║  ██║██║   ██║██║╚██╔╝██║   ██║   ██║██║   ██║██╔══██╗
 ██║██║ ╚████║   ██║   ███████╗███████╗██╗██████╔╝╚██████╔╝██║ ╚═╝ ██║██╗╚██████╔╝╚██████╔╝██████╔╝
 ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝╚═╝╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝  ╚═════╝ ╚═════╝'

show_banner() {
  local ACTION="${1:-}"
  echo -e "\033[38;5;202m${INTEL_LOGO}\033[0m"
  echo -e "  \033[1;37mPlataforma de Inteligencia Gubernamental · Estado Dominicano\033[0m"
  echo -e "  \033[2mDeep Research en fuentes oficiales .do · multi-agente · RAG\033[0m"
  if [ -n "$ACTION" ]; then
    echo -e "  \033[38;5;202m▶ ${ACTION}\033[0m"
  fi
  echo ""
}

show_endpoints() {
  echo -e "  \033[1;37mEndpoints expuestos\033[0m"
  echo -e "  \033[38;5;202m─────────────────────\033[0m"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "RUTA" "MÉTODO" "DESCRIPCIÓN"
  printf "  \033[38;5;202m%-14s\033[0m %-8s %s\n" "──────────────" "────────" "──────────────────────────────────────"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/api/health"   "GET"    "Estado del servidor y API key configurada"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/api/url-tree" "GET"    "Árbol de URLs de portales (cache + ?refresh=1)"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "  ?portals"    "QUERY"  "Filtra portales p.ej. ?portals=Presidencia,Senado"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/api/query"    "POST"   "Bucle multi-agente: consulta + evidencia oficial"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "  body"        "JSON"   "{ query, institutions[], model, apiKey, search, responseLang }"
  printf "  \033[1;36m%-14s\033[0m %-8s %s\n" "/* (SPA)"      "GET"    "Frontend (Vite dev / static build)"
  echo ""
  echo -e "  \033[2mServidor:\033[0m \033[4mhttp://0.0.0.0:3000\033[0m"
  echo ""
}

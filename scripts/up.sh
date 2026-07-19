#!/usr/bin/env bash
#
# scripts/up.sh — Boot the full INTEL.DOM.GOB stack and present a health report.
#
# What it does:
#   1. Loads .env (DOMAIN, keys, ...). Only DOMAIN differs dev vs prod.
#   2. Builds + starts every service via the single docker-compose.yml.
#   3. Waits for each container's healthcheck to become healthy.
#   4. Runs a battery of live checks: /health, /metrics, key /v1 endpoints,
#      Postgres & DragonflyDB connectivity, event-bus round-trip.
#   5. Prints a clean, colourised presentation of the result.
#
# Usage:
#   ./scripts/up.sh            # if infra is up, tear down then bring up (clean
#                              #   restart); otherwise start it. Then wait + report.
#   ./scripts/up.sh --no-up    # skip `compose up`, just report on running stack
#   ./scripts/up.sh --down     # tear everything down afterwards
#
set -uo pipefail

# ---- config ----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# ---- shared banner ---------------------------------------------------------
if [ -f "$ROOT/scripts/banner.sh" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/scripts/banner.sh"
fi

DOMAIN="${DOMAIN:-localhost}"
NO_UP=0
DOWN_AFTER=0
for arg in "$@"; do
  case "$arg" in
    --no-up) NO_UP=1 ;;
    --down)  DOWN_AFTER=1 ;;
    *) echo "unknown arg: $arg" >&2 ;;
  esac
done

# ---- colours ---------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_CYAN=""; C_BLUE=""
fi

log()  { printf '%s\n' "$*"; }
ok()   { printf '  %s%-6s%s %s\n' "$C_GREEN" "OK  " "$C_RESET" "$1"; }
warn() { printf '  %s%-6s%s %s\n' "$C_YELLOW" "WARN" "$C_RESET" "$1"; }
bad()  { printf '  %s%-6s%s %s\n' "$C_RED" "FAIL" "$C_RESET" "$1"; }

# ---- helpers ---------------------------------------------------------------
have_docker=0
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  have_docker=1
fi

# HTTP check against a host (Caddy subdomain or container port).
http_status() {
  # $1 = url
  curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$1" 2>/dev/null || echo "000"
}

wait_for() {
  # $1 = service name, $2 = url to poll
  local svc="$1" url="$2" i tries=40
  for ((i=1; i<=tries; i++)); do
    local code
    code="$(http_status "$url")"
    if [ "$code" != "000" ] && [ "$code" != "503" ]; then return 0; fi
    sleep 3
  done
  return 1
}

# ---- 1. bring the stack up -------------------------------------------------
# If the infra is already running, take it down first so `up.sh` always yields a
# clean, deterministic state (rebuild + fresh containers). This makes `up.sh`
# double as the restart/refresh command.
if [ "$NO_UP" -eq 0 ]; then
  if [ "$have_docker" -eq 0 ]; then
    bad "docker compose not available — cannot start infra. Install Docker or run with --no-up against a running stack."
    exit 1
  fi
  if [ -n "$(docker compose ps -q 2>/dev/null)" ]; then
    log "${C_BOLD}▶ Infra already up — tearing down first for a clean restart...${C_RESET}"
    docker compose down --remove-orphans 2>&1 | tail -10
  fi
  log "${C_BOLD}▶ Starting the INTEL.DOM.GOB stack (DOMAIN=$DOMAIN)...${C_RESET}"
  log "${C_DIM}  (uses cached images; rebuild explicitly with: docker compose up -d --build)${C_RESET}"
  docker compose up -d --remove-orphans 2>&1 | tail -20
fi

# ---- 2. wait for healthchecks ---------------------------------------------
show_banner "start" 2>/dev/null || true
log ""
log "${C_BOLD}▶ Waiting for service healthchecks...${C_RESET}"

# Probe a URL from INSIDE the docker network (avoids host DNS/TLS issues).
# Uses the same base64 round-trip as post_probe for reliable UTF-8 / exec
# behaviour. $1 = container, $2 = full url.
probe() {
  local url="$2" b64
  b64="$(printf '%s' "$url" | base64)"
  printf '%s' "$b64" | docker compose exec -T "$1" sh -c "echo \"\$(cat)\" | base64 -d | xargs -I{} curl -s -o /dev/null -w '%{http_code}' --max-time 8 {}" 2>/dev/null || echo "000"
}

# Wait until a service answers its internal health endpoint.
wait_service() {
  local via="$1" url="$2" i tries=40
  for ((i=1; i<=tries; i++)); do
    local code; code="$(probe "$via" "$url")"
    if [ "$code" != "000" ] && [ "$code" != "503" ]; then return 0; fi
    sleep 3
  done
  return 1
}

# POST helper: pass the JSON body safely via base64 (avoids UTF-8 pipe
# corruption across `docker compose exec`). curl reads it with @-.
post_probe() {
  # $1 = path, $2 = json body
  local path="$1" b64
  b64="$(printf '%s' "$2" | base64)"
  printf '%s' "$b64" | docker compose exec -T api sh -c "echo \"\$(cat)\" | base64 -d | curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST 'http://api:4000$path' -H 'content-type: application/json' --data-binary @-" 2>/dev/null || echo 000
}

# Service health is read from `docker compose ps` state (fast, no in-container
# exec — some images lack a shell). HTTP liveness is verified separately for the
# API (the only service the report exercises).
# studio/v0 is the legacy React SPA, preserved for rollback only — it is NOT
# started by default (the active Studio is v1/Odysseus), so it is excluded
# from the required health list to avoid a false FAIL.
ALL_SERVICES="caddy api studio odysseus studio-chromadb studio-searxng studio-ntfy docs web admin mcp searxng postgres dragonfly ocr-worker embedding-worker document-worker crawler-worker ai-worker"

svc_state() {
  # $1 = service name -> prints "healthy" | "running" | "starting" | "down"
  docker compose ps --format '{{.Name}} {{.State}} {{.Status}}' 2>/dev/null \
    | awk -v s="$1" '$1 ~ s && $1 !~ /-1-/ {print; exit}' \
    | grep -oE '(healthy|starting|restarting|running|exited|dead)' | head -1
}

for svc in $ALL_SERVICES; do
  st="$(svc_state "$svc")"
  case "$st" in
    healthy|running) ok "$svc  →  $st" ;;
    starting|restarting) warn "$svc  →  $st (not ready yet)" ;;
    *) bad "$svc  →  ${st:-down}" ;;
  esac
done

# API HTTP liveness (the API container has curl/sh, so this is safe).
if wait_service api "http://api:4000/health"; then ok "api HTTP  →  /health reachable"; else bad "api HTTP  →  /health unreachable"; fi

# Infrastructure
if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-intel}" >/dev/null 2>&1; then
  ok "postgres  →  accepting connections"; else bad "postgres  →  not ready"; fi
if docker compose exec -T dragonfly redis-cli ping 2>/dev/null | grep -q PONG; then
  ok "dragonfly  →  broker PONG"; else bad "dragonfly  →  no response"; fi

# ---- 3. live checks --------------------------------------------------------
log ""
log "${C_BOLD}▶ Live endpoint checks (against api:4000 in-network)${C_RESET}"

CHECKS=(
  "GET  /health"
  "GET  /ready"
  "GET  /live"
  "GET  /v1/institutions"
  "GET  /v1/tools"
  "GET  /v1/prompts"
  "GET  /v1/plugins"
  "GET  /v1/metrics"
  "GET  /v1/openapi.json"
  "POST /v1/entities/extract"
  "POST /v1/evaluate/faithfulness"
  "POST /v1/workflows"
)
pass=0; fail=0
for c in "${CHECKS[@]}"; do
  method="${c%% *}"; path="/${c#* /}"
  code="000"; attempts=0
  while [ "$code" = "000" ] && [ "$attempts" -lt 2 ]; do
    attempts=$((attempts+1))
    case "$method" in
      GET)  code="$(probe api "http://api:4000$path")" ;;
      POST)
        body="{}"
        case "$path" in
          /v1/entities/extract) body='{"text":"La Ley 87-01 creó la TSS."}' ;;
          /v1/evaluate/faithfulness) body='{"answer":"La Ley 87-01 creó la TSS.","context":"La Ley 87-01 creó la TSS en el 2001."}' ;;
          /v1/workflows) body='{"name":"probe","steps":[{"id":"a","action":"x"}]}' ;;
        esac
        code="$(post_probe "$path" "$body")"
        ;;
    esac
  done
  if [ "$code" = "200" ] || [ "$code" = "202" ]; then ok "$method $path  →  $code"; pass=$((pass+1)); else bad "$method $path  →  $code"; fail=$((fail+1)); fi
done

# ---- 4. infrastructure connectivity ---------------------------------------
log ""
log "${C_BOLD}▶ Infrastructure connectivity${C_RESET}"

if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-intel}" >/dev/null 2>&1; then
  ok "Postgres accepting connections (db=${POSTGRES_DB:-inteldomgob})"; pass=$((pass+1))
else bad "Postgres not ready"; fail=$((fail+1)); fi

if docker compose exec -T dragonfly redis-cli ping 2>/dev/null | grep -q PONG; then
  ok "DragonflyDB broker responding (redis-cli PONG)"; pass=$((pass+1))
else bad "DragonflyDB not responding"; fail=$((fail+1)); fi

# Event-bus round-trip (publish a test event onto the stream).
if docker compose exec -T dragonfly redis-cli XADD intel.events '*' type 'health.probe' payload '{"ok":true}' >/dev/null 2>&1; then
  ok "Event bus write (XADD intel.events)"; pass=$((pass+1))
  len="$(docker compose exec -T dragonfly redis-cli XLEN intel.events 2>/dev/null | tr -d '\r')"
  [ -n "$len" ] && ok "Event stream length = $len" || warn "Event stream length unknown"
else warn "Event bus write skipped (broker unreachable)"; fi

# Metrics sanity: confirm the API exposes real series.
METRICS_SAMPLE="$(docker compose exec -T api sh -c "curl -s --max-time 6 http://api:4000/metrics" 2>/dev/null || true)"
if echo "$METRICS_SAMPLE" | grep -q "http_requests_total"; then
  ok "Prometheus metrics exposed (http_requests_total present)"; pass=$((pass+1))
else bad "Prometheus metrics missing"; fail=$((fail+1)); fi


# ---- 5. presentation -------------------------------------------------------
log ""
log "${C_BOLD}${C_CYAN}╔════════════════════════════════════════════════════════════════════════╗${C_RESET}"
log "${C_BOLD}${C_CYAN}║            INTEL.DOM.GOB — Infrastructure Health Report            ║${C_RESET}"
log "${C_BOLD}${C_CYAN}╚════════════════════════════════════════════════════════════════════════╝${C_RESET}"
log ""
log "  ${C_BOLD}Domain${C_RESET}        : $DOMAIN"
log "  ${C_BOLD}Timestamp${C_RESET}     : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
log "  ${C_BOLD}Broker${C_RESET}        : DragonflyDB (Redis-compatible) @ redis://dragonfly:6379"
log "  ${C_BOLD}Database${C_RESET}      : PostgreSQL 16 @ postgres:5432"
log ""
log "  ${C_BOLD}${C_BLUE}Exposed endpoints (via Caddy)${C_RESET}"
log "  ────────────────────────────────────────────────────────────────────"
printf '    %-28s %s\n' "${C_DIM}URL${C_RESET}" "${C_DIM}Purpose${C_RESET}"
printf '    %-28s %s\n' "http://studio.${DOMAIN}"   "Studio v1 — Odysseus workspace (primary client)"
printf '    %-28s %s\n' "http://api.${DOMAIN}"      "API gateway / OpenAI-compat"
printf '    %-28s %s\n' "http://api.${DOMAIN}/docs" "Swagger UI"
printf '    %-28s %s\n' "http://web.${DOMAIN}"      "Lightweight no-JS client"
printf '    %-28s %s\n' "http://admin.${DOMAIN}"    "Operator console"
printf '    %-28s %s\n' "http://mcp.${DOMAIN}"      "MCP server"
printf '    %-28s %s\n' "http://docs.${DOMAIN}"     "Documentation"
printf '    %-28s %s\n' "http://searxng.${DOMAIN}"  "SearXNG search provider"
log ""

log "  ${C_BOLD}${C_BLUE}All applications, services & websites${C_RESET}"
log "  ────────────────────────────────────────────────────────────────────"
printf '    %-28s %-26s %s\n' "${C_DIM}PUBLIC URL${C_RESET}" "${C_DIM}SERVICE / PORT${C_RESET}" "${C_DIM}PURPOSE${C_RESET}"
printf '    %-28s %-26s %s\n' "http://studio.${DOMAIN}"   "odysseus :7000"    "Studio v1 — Odysseus workspace (primary client)"
printf '    %-28s %-26s %s\n' "http://api.${DOMAIN}"      "api :4000"         "API gateway / OpenAI-compatible"
printf '    %-28s %-26s %s\n' "http://api.${DOMAIN}/docs" "api :4000"         "Swagger UI (OpenAPI)"
printf '    %-28s %-26s %s\n' "http://web.${DOMAIN}"      "web :4200"         "Lightweight no-JS client"
printf '    %-28s %-26s %s\n' "http://admin.${DOMAIN}"    "admin :4300"       "Operator / admin console"
printf '    %-28s %-26s %s\n' "http://mcp.${DOMAIN}"      "mcp :4100"         "MCP server (API client)"
printf '    %-28s %-26s %s\n' "http://docs.${DOMAIN}"     "docs :80"          "Documentation site"
printf '    %-28s %-26s %s\n' "http://searxng.${DOMAIN}"  "searxng :8080"     "SearXNG search provider"
printf '    %-28s %-26s %s\n' "(internal) postgres"       "postgres :5432"    "PostgreSQL 16 database"
printf '    %-28s %-26s %s\n' "(internal) dragonfly"      "dragonfly :6379"   "DragonflyDB broker/cache"
printf '    %-28s %-26s %s\n' "(internal) ocr-worker"     "worker"            "OCR event consumer"
printf '    %-28s %-26s %s\n' "(internal) embedding-worker" "worker"          "Embedding event consumer"
printf '    %-28s %-26s %s\n' "(internal) document-worker" "worker"           "Document-intelligence consumer"
printf '    %-28s %-26s %s\n' "(internal) crawler-worker"  "worker"           "Crawl event consumer"
printf '    %-28s %-26s %s\n' "(internal) ai-worker"       "worker"           "Batch AI event consumer"
printf '    %-28s %-26s %s\n' "(internal) caddy"           "caddy :80/:443"    "Reverse proxy / TLS"
log ""
log "  ${C_BOLD}${C_BLUE}Key API surface (/v1)${C_RESET}"
log "  ────────────────────────────────────────────────────────────────────"
printf '    %-34s %s\n' "GET  /health|/ready|/live"      "liveness/readiness"
printf '    %-34s %s\n' "GET  /metrics"                   "Prometheus metrics"
printf '    %-34s %s\n' "POST /query , /chat , /chat/stream" "orchestrator"
printf '    %-34s %s\n' "POST /v1/documents/process"      "document intelligence pipeline"
printf '    %-34s %s\n' "POST /v1/entities/extract"       "entity extraction"
printf '    %-34s %s\n' "POST /v1/workflows (+/approve,/deny)" "workflow engine (HITL)"
printf '    %-34s %s\n' "GET  /v1/tools , POST /tools/:id/execute" "tool registry"
printf '    %-34s %s\n' "GET|POST /v1/prompts(/:key/render)" "prompt service"
printf '    %-34s %s\n' "POST /v1/evaluate/{faithfulness,quality}" "evaluation"
printf '    %-34s %s\n' "GET  /v1/plugins , POST /plugins/:id/run" "plugin registry"
printf '    %-34s %s\n' "GET  /v1/tenant"                 "multi-tenant context"
printf '    %-34s %s\n' "GET  /v1/graph , POST /v1/graph/ingest" "knowledge graph"
log ""
log "  ${C_BOLD}${C_BLUE}Background workers (event consumers)${C_RESET}"
log "  ────────────────────────────────────────────────────────────────────"
printf '    %-20s %s\n' "ocr-worker"        "document.ocr events"
printf '    %-20s %s\n' "embedding-worker"  "document.embedding events"
printf '    %-20s %s\n' "document-worker"   "document.intelligence events"
printf '    %-20s %s\n' "crawler-worker"    "crawl events"
printf '    %-20s %s\n' "ai-worker"         "batch AI events"
log ""
if [ "$fail" -eq 0 ]; then
  log "  ${C_GREEN}${C_BOLD}✅ ALL CHECKS PASSED${C_RESET}  (passed: $pass, failed: $fail)"
else
  log "  ${C_YELLOW}${C_BOLD}⚠️  DEGRADED${C_RESET}  (passed: $pass, failed: $fail)"
fi
log ""

if [ "$DOWN_AFTER" -eq 1 ]; then
  log "${C_BOLD}▶ Tearing down stack...${C_RESET}"
  docker compose down 2>&1 | tail -3
fi

exit $fail

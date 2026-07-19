# Changelog

All notable changes to INTEL.DOM.GOB are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — Platform Architecture Refactor

### Added
- Clean monorepo with layered architecture: `packages/`, `providers/`, `services/`, `apps/`.
- `packages/types` — shared domain contract between all layers.
- `packages/logger` — structured logging (timestamp, service, level, requestId).
- `packages/config` — validated environment configuration (develop == production).
- `packages/utils` — framework-agnostic helpers (tokenization, fetch, dedupe).
- `packages/sdk` — the single client surface for all clients.
- `providers/searxng` — default Search Provider (preserves existing anonymous JSON API).
- `providers/gemini` — default AI Provider (wraps `@google/genai`, retry/backoff).
- `providers` registry — `registerSearch` / `registerAi` / `listSearch` / `listAi`.
- `services/ai` — `AiService` (generate, generateJson with truncated-JSON repair, chat).
- `services/search` — `SearchService` (SearXNG fan-out + declarative news engines).
- `services/institutions` — 8 pluggable DR government source plugins (Senado, Cámara, Presidencia, Tribunal Constitucional, DGCP, Datos Abiertos, Consultoría, Compras).
- `services/crawler` — categorized URL-tree builder.
- `services/orchestrator` — the heart: multi-agent reasoning, FLUJO assembly, evidence, timeline.
- `apps/api` — Express gateway, versioned `/v1`, health/ready/live, delegates to Orchestrator.
- `apps/studio` — React SPA client consuming the API only (no business logic).
- Single `docker-compose.yml` (api, studio, searxng, postgres, dragonfly, caddy).
- Caddy reverse proxy with subdomain routing + automatic HTTPS.
- Full `scripts/` suite: init, start, stop, restart, logs, doctor, backup, restore, lint, format, test, clean, update, deploy.
- Docs: README, AGENTS, CONTRIBUTING, CHANGELOG, docs/.

### Changed
- Split the original monolithic `ChatGobDO` (Express + React in one process) into the
  API-first layered architecture described in WORK.md.
- Clients now talk to the API via `@intel.dom.gob/sdk` instead of hardcoded endpoints.

### Preserved
- `docker/searxng/settings.yml` — original anonymous JSON API configuration, unchanged.
- Institution retrieval logic, FLUJO A–E streams, evidence matrix, and legislative timeline.
- Studio UI design language (colors, typography, layout, components, branding).

### Notes
- Future providers (Brave, OpenAI, Anthropic, Ollama), OCR (Unlimited-OCR), Presentation
  (HyperFrames), Memory (codebase-memory-mcp) and Knowledge Graph are designed as drop-in
  extensions and do not require architectural changes.

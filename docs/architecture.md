# Architecture — INTEL.DOM.GOB

This document complements `README.md` with the detailed, layer-by-layer architecture
and the rationale behind the key decisions (see also `docs/adr.md`).

## Flow

```
Client (Studio / CLI / MCP / SDK)
        │  HTTPS
        ▼
   API Gateway (apps/api)            /v1/*  — no business logic
        │
        ▼
   Orchestrator (services/orchestrator)   — the heart
        ├── plans which institutions to target
        ├── fans out SearXNG + institution searches + DR press
        ├── builds the grounded prompt
        ├── calls AI Service
        └── assembles the deterministic IntelligenceResult
        │
        ▼
   Services: Search · AI · Institutions · Crawler
        │
        ▼
   Providers: SearXNG (search) · Gemini (AI)
        │
        ▼
   External: SearXNG instance · Google Gemini
```

## Why this layering

* **API is the contract.** Every client consumes the same surface. Adding a mobile app
  or third-party integration requires zero changes to services.
* **Orchestrator owns business logic.** The multi-agent reasoning, FLUJO assembly, and
  evidence/timeline construction live in one place — testable and evolvable.
* **Providers are swappable.** SearXNG and Gemini are defaults; Brave/OpenAI/etc. drop in
  via the registry. No service code changes.
* **Institutions are plugins.** Each DR government source is an isolated module behind
  `InstitutionService`. The UI discovers them dynamically.

## Reverse proxy & "develop like production"

Caddy exposes every app via a subdomain:

```
studio.<DOMAIN>   -> Studio SPA
api.<DOMAIN>      -> API gateway
docs.<DOMAIN>     -> documentation
```

Only `DOMAIN` differs between environments (`localhost` vs `intel.dom.gob`). Caddy
auto-manages HTTPS. No service publishes a port except Caddy; internal communication uses
Docker DNS by service name (`api`, `searxng`, `postgres`, `dragonfly`).

## Data flow of a query (FLUJOs)

1. Orchestrator resolves target institutions (or all, if none selected).
2. Parallel fan-out: SearXNG web search, per-institution `search()`, Senado/Cámara SIL
   laws, Senado bulletins, Dominican press via news engines.
3. Results are tagged, de-duplicated, and split into FLUJO streams (A congress, B tribunal,
   C datos, D news, E bulletins).
4. The grounded prompt is sent to the AI Provider with a strict JSON schema.
5. `buildResult()` merges the model's JSON with the REAL retrieved data deterministically —
   the UI never shows hallucinated or missing sources.

## Future extension points (no architectural change required)

* **OCR Service** — provider-backed (Unlimited-OCR), interface `extractText/extractMarkdown`.
* **Presentation Service** — HyperFrames export plugin invoked by the Orchestrator.
* **Memory Service** — codebase-memory-mcp for AI agent context.
* **Knowledge Graph Service** — entity relationships between laws/decrees/rulings.
* **Auth** — JWT, API keys, OAuth, orgs, teams, permissions.
* **Streaming** — SSE/WebSockets for search progress and tool execution.

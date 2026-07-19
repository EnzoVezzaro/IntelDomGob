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
        ├── plans which institutions to target (QueryPlanner)
        ├── fans out SearXNG + institution searches + DR press
        ├── builds the grounded prompt
        ├── calls AI Service
        ├── streams tokens (SSE)
        └── assembles the deterministic IntelligenceResult
        │
        ▼
   Core Services (25+)
   ───────────────────────────────
   Search · AI · Institutions · Crawler · OCR · Memory · RAG ·
   Knowledge Graph · Entities · Document Intelligence · Workflow ·
   Embeddings · Storage · Auth · Evaluation · Observability ·
   Tool Registry · Prompts · Scheduler · Tenancy · Plugins
        │
        ▼
   Providers (12)
   ───────────────────────────────
   SearXNG · Gemini · OpenAI · Anthropic · DeepSeek · Ollama ·
   Brave · Tavily · Exa · Unlimited-OCR · HyperFrames
        │
        ▼
   External Systems
   ───────────────────────────────
   SearXNG · Google Gemini · OpenAI · Cámara SIL API ·
   Senado DSpace · DR Government Portals
```

## Why this layering

* **API is the contract.** Every client consumes the same surface. Adding a mobile app
  or third-party integration requires zero changes to services.
* **Orchestrator owns business logic.** The multi-agent reasoning, FLUJO assembly, and
  evidence/timeline construction live in one place — testable and evolvable.
* **Providers are swappable.** SearXNG and Gemini are defaults; Brave/OpenAI/Ollama/etc. drop in
  via the registry. No service code changes.
* **Institutions are plugins.** Each DR government source is an isolated module behind
  `InstitutionService`. The UI discovers them dynamically.
* **Workers offload heavy work.** OCR, embeddings, crawling, and batch AI are async via
  DragonflyDB Streams, never blocking the API request path.

## Reverse proxy & "develop like production"

Caddy exposes every app via a subdomain:

```
studio.<DOMAIN>   -> Studio SPA (Odysseus)
api.<DOMAIN>      -> API gateway
mcp.<DOMAIN>      -> MCP server
web.<DOMAIN>      -> Web client
admin.<DOMAIN>    -> Admin console
docs.<DOMAIN>     -> documentation
```

Only `DOMAIN` differs between environments (`localhost` vs `intel.dom.gob`). Caddy
auto-manages HTTPS. No service publishes a port except Caddy; internal communication uses
Docker DNS by service name (`api`, `searxng`, `postgres`, `dragonfly`).

## Data flow of a query (FLUJOs)

1. Orchestrator resolves target institutions (or all, if none selected).
2. QueryPlanner decomposes the query into intent-aware search queries (model-agnostic, configurable via `LLM_MODEL`).
3. Parallel fan-out: SearXNG web search, per-institution `search()`, Senado/Cámara SIL
   laws, Senado bulletins, Dominican press via news engines.
4. Results are tagged, de-duplicated, and split into FLUJO streams:
   - **FLUJO A** — Congreso Nacional (congress + tribunal + datos)
   - **FLUJO B** — Tribunal Constitucional decisions
   - **FLUJO C** — Datos Abiertos datasets
   - **FLUJO D** — Dominican press / media coverage
   - **FLUJO E** — Senado DSpace bulletins, actas, documents
5. The grounded prompt is sent to the AI Provider with a strict JSON schema.
6. `buildResult()` merges the model's JSON with the REAL retrieved data deterministically —
   the UI never shows hallucinated or missing sources.

## Event-driven architecture

Heavy work (OCR, embeddings, crawling, batch AI) is offloaded from the synchronous request path:

```
API / Service  →  EventBus (DragonflyDB Streams)  →  Worker Consumer
```

Canonical events:
- `document.uploaded` → `ocr-worker` picks up
- `ocr.started` / `ocr.completed` → `embedding-worker` picks up
- `embedding.completed` → graph enrichment
- `document.intelligence.completed` → pipeline done
- `crawl.completed` → URL tree ready
- `workflow.started` / `workflow.approval_requested` / `workflow.completed`

The EventBus falls back to in-memory pub/sub when no DragonflyDB is available.

## Document Intelligence Pipeline

```
Upload document
    ↓
StorageService (local / S3)
    ↓
OcrService → OcrProvider (Unlimited-OCR)
    ↓
Text extraction (extractText / extractMarkdown / extractTables)
    ↓
Classification (legislation / procurement / jurisprudence / finance / general)
    ↓
EntitiesService (People, Orgs, Laws, Institutions, Dates, Locations)
    ↓
EmbeddingsService (Gemini text-embedding-004 or hash fallback)
    ↓
KnowledgeGraphService (entity-relationship graph)
    ↓
Available for AI / RAG
```

## Workflow Engine

Multi-step intelligence pipelines execute as a DAG:

```
Step A (search Senate)  ──→  Step B (download PDFs)  ──→  Step C (OCR)
                                                            ↓
Step F (generate report)  ←──  Step E (extract entities)  ←──  Step D (embed)
```

- Topological ordering (Kahn's algorithm)
- Retries with exponential backoff
- Timeout per step
- Human-in-the-loop: steps with `requiresApproval` pause the workflow
- API: `POST /v1/workflows`, `POST /v1/workflows/:id/approve`, `POST /v1/workflows/:id/deny`

## Authentication & Authorization

- **API Keys**: hashed, stored in PostgreSQL, scoped (read / query / chat / admin / execute)
- **JWT**: verify support for future OAuth integration
- **RBAC**: scope enforcement at the API gateway level
- **ABAC**: attribute constraints (clearance, department, tenant) — deny-by-default
- **Multi-tenancy**: TenantResolver resolves tenant from API key record; X-Tenant-Id header validated against key's tenant to prevent spoofing
- Optional: `REQUIRE_API_KEY=false` in development, `true` in production

## Observability

In-process metrics (counters, gauges, histograms) + distributed tracing (spans):

- Prometheus text export at `/v1/metrics` and `/metrics`
- HTTP request duration + status code tracking
- Pluggable: swap for OpenTelemetry / Grafana / Loki later

## Storage Architecture

Pluggable `StorageBackend` interface:

- **Default**: Local filesystem (`/data/storage`)
- **Production**: Swap for S3, MinIO, Google Cloud Storage, Azure Blob
- Used by: Document Intelligence pipeline, presentation exports

## Knowledge Graph

Entity-relationship graph over intelligence results:

- Entities: laws, institutions, persons, events, concepts, documents
- Relations: cites, amends, involves, references, related_to
- Pluggable `GraphStore` (in-memory default; swap for Neo4j / ArangoDB / PostgreSQL + AGE)
- Fed by: IntelligenceResult ingestion, Document Intelligence pipeline
- Queried via: `/v1/graph`, `/v1/graph/ingest`

## Future extension points (no architectural change required)

* **Vector Database** — not currently implemented; in-memory embeddings + cosine similarity. Add Qdrant/pgvector when corpus grows.
* **WebSocket streaming** — SSE covers current needs; add WS for bidirectional tool execution.
* **OAuth / Teams** — JWT + API-key scopes exist; add OAuth provider and team management.
* **Mobile Apps / Browser Extension** — consume the same API via SDK.
* **External MCP integrations** — any MCP client can connect to our MCP server.

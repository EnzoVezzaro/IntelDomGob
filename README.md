# INTEL.DOM.GOB

**Plataforma de Inteligencia Gubernamental del Estado Dominicano** — API-first, multi-agente, basada en evidencia oficial.

> Inteligencia del Estado Dominicano, basada en evidencia oficial — API-first, multi-agente y de código abierto.

---

## Vision

INTEL.DOM.GOB es una plataforma de inteligencia estatal impulsada por IA que realiza *deep research* en tiempo real sobre las fuentes oficiales de la República Dominicana. Cada consulta dispara un **bucle multi-agente de recuperación y razonamiento** que busca, lee, contrasta y sintetiza información oficial antes de responder.

La arquitectura gira en torno al **API**. El SDK es la única superficie de acceso; los clientes hablan con el SDK y el SDK habla con el API. Todo fluye a través de:

```
Cliente → SDK → API → Orchestrator → Services → Providers → External Systems
```

Ningún cliente habla directamente con servicios o proveedores. Los clientes que no importan el SDK (Studio v1, CLI) se conectan al **servidor MCP**, que es él mismo un cliente del SDK.

### Core Principles

* **Local-first** — local open-source components (SearXNG, Gemini, Ollama, DragonflyDB) as defaults
* **Open Source First** — MIT license, fully self-hostable
* **Vendor Neutral** — swap any provider without code changes
* **Offline Friendly** — Ollama + local SearXNG + hash embeddings work without internet
* **Docker First** — single `docker-compose.yml`, develop exactly like production
* **S3 Compatible Storage** — pluggable `StorageBackend` interface (local filesystem default; S3/MinIO/GCS adapters designed but not yet implemented)
* **Zero Vendor Lock-in** — every external system behind a Provider interface

---

## Architecture

```
Clients (two surfaces)
──────────────────────────────────────────────────────────────────────────────
  Direct SDK clients: Web (presentation/landing) · Admin · Studio v0
                         │
                         ▼
  MCP-only clients:  Studio v1 · CLI
                         │  (MCP protocol — Streamable HTTP / SSE / JSON-RPC)
                         ▼
                    MCP server (@intel.dom.gob/services/mcp — pure SDK client)
                         │
                         ▼
    SDK  (@intel.dom.gob/sdk — the ONLY surface that talks to the API)
         │  (HTTPS via reverse proxy / subdomains)
         ▼
    API (api.intel.dom.gob)        ← gateway, REST + SSE, versioned /v1
         │
         ▼
    Orchestrator                   ← heart: planning, search, AI, merge
         │
         ▼
    Core Services
    ───────────────────────────────
    Search · AI · Institutions · Crawler · OCR · Memory · RAG ·
    Knowledge Graph · Entities · Document Intelligence · Workflow ·
    Embeddings · Storage · Auth · Evaluation · Observability ·
    Tool Registry · Prompts · Scheduler · Tenancy · Plugins
         │
         ▼
    Providers
    ───────────────────────────────
    SearXNG (default search) · Gemini (default AI) · + 10 optional providers
         │
         ▼
    Infrastructure
    ───────────────────────────────
    PostgreSQL · DragonflyDB · Object Storage · Docker · Caddy
```

### Layered principles

* **SDK is the only API surface** — `@intel.dom.gob/sdk` is the one and only way any client reaches the API. Web (presentation/landing), Admin and Studio v0 import the SDK directly; the MCP server imports the SDK; Studio v1 and the CLI never import the SDK — they go through the MCP server, which itself is a pure SDK client.
* **Separation of Concerns** — cada capa tiene exactamente una responsabilidad.
* **Provider abstraction** — todo lo externo está detrás de un Provider. Añadir Brave/OpenAI/Ollama = crear una implementación, nada más.
* **Pluggable services** — cada servicio es independiente y testeable.
* **Develop exactly like production** — mismo Docker Compose, solo cambia `DOMAIN`.

---

## Repository Layout

```
intel.dom.gob/
├── apps/
│   ├── api/              # Express API gateway (delegates to Orchestrator)
│   ├── studio/v0/        # Legacy React SPA client (preserved for rollback) — SDK-direct
│   ├── studio/v1/        # Active Studio: Odysseus workspace (AGPL-3.0 fork) — MCP-only
│   ├── web/              # Lightweight no-JS presentation/landing client (SDK-direct)
│   ├── admin/            # Operator/admin console (SDK-direct)
│   └── cli/              # Command-line client (MCP-only)
├── services/
│   ├── orchestrator/     # business logic: multi-agent reasoning, planning, streaming
│   ├── search/           # Web/news retrieval via Search Provider
│   ├── ai/               # Model calls via AI Provider
│   ├── institutions/     # 8 pluggable DR government source plugins
│   ├── crawler/          # URL-tree builder
│   ├── auth/             # API keys, JWT, RBAC/ABAC
│   ├── embeddings/       # Text embeddings (Gemini semantic, hash fallback)
│   ├── rag/              # Retrieval-augmented generation
│   ├── memory/           # Codebase/architecture memory
│   ├── documents/        # Document chunking/cleaning
│   ├── ocr/              # OCR delegation to OcrProvider
│   ├── storage/          # Object storage abstraction (local, S3, GCS)
│   ├── knowledge-graph/  # Entity-relationship graph over intelligence results
│   ├── entities/         # Rule-based entity extraction (People, Orgs, Laws, …)
│   ├── document-intelligence/  # Full pipeline: Storage→OCR→Entities→Embeddings→KG
│   ├── workflow/         # DAG execution engine with retries, checkpoints, HITL
│   ├── tool-registry/    # Declarative, discoverable tools for agents / MCP
│   ├── prompts/          # Versioned prompt templates with {{var}} rendering
│   ├── evaluation/       # Answer faithfulness / quality evaluators
│   ├── observability/    # In-process metrics + tracing, Prometheus export
│   ├── tenancy/          # Multi-tenant resolution + data isolation
│   ├── plugins/          # Guarded plugin extension registry
│   ├── scheduler/        # In-process job scheduler
│   ├── presentation/     # Presentation artifacts via PresentationProvider
│   └── mcp/              # MCP server (pure SDK client of the API)
├── providers/
│   ├── searxng/          # default Search Provider
│   ├── gemini/           # default AI Provider (with stream())
│   ├── openai/           # optional AI Provider
│   ├── anthropic/        # optional AI Provider
│   ├── deepseek/         # optional AI Provider
│   ├── ollama/           # optional AI Provider (local models)
│   ├── brave/            # optional Search Provider
│   ├── tavily/           # optional Search Provider
│   ├── exa/              # optional Search Provider
│   ├── unlimited-ocr/    # optional OCR Provider
│   └── hyperframes/      # optional Presentation Provider
├── workers/
│   ├── ocr-worker/       # Async OCR processing
│   ├── embedding-worker/ # Async embedding generation
│   ├── document-worker/  # Async document intelligence pipeline
│   ├── crawler-worker/   # Async URL-tree crawling
│   └── ai-worker/        # Async AI generation tasks
├── packages/
│   ├── types/            # shared domain types
│   ├── logger/           # structured logging
│   ├── config/           # env configuration
│   ├── utils/            # shared utilities
│   ├── sdk/              # the ONLY surface that talks to the API
│   ├── database/         # ORM-free Postgres pool + migrations
│   ├── events/           # Event bus (DragonflyDB Streams + in-memory fallback)
│   └── ui/               # shared Panel + Button primitives
├── docker/
│   ├── caddy/            # reverse proxy (subdomain routing + HTTPS)
│   ├── searxng/          # preserved SearXNG settings
│   └── docs/             # documentation site
├── iac/
│   ├── terraform/        # Terraform infrastructure as code
│   ├── pulumi/           # Pulumi infrastructure as code
│   └── helm/             # Kubernetes Helm chart
├── scripts/              # start / stop / doctor / deploy / …
├── tests/                # 105+ tests across 17 files
├── docker-compose.yml
├── .env.example
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
└── CHANGELOG.md
```

---

## Quick Start

```bash
# 1. Clone & configure
git clone <repo> intel.dom.gob
cd intel.dom.gob
cp .env.example .env          # set DEFAULT_AI_API_KEY, DOMAIN

# 2. One command brings up the whole platform
./scripts/up.sh
```

Then open:

* **Studio** → http://studio.localhost
* **API** → http://api.localhost/v1/health
* **API Docs (Swagger)** → http://api.localhost/v1/docs
* **MCP** → http://mcp.localhost/health
* **Web** → http://web.localhost
* **Admin** → http://admin.localhost
* **Docs** → http://docs.localhost

### Local URLs (development)

```
https://studio.localhost
https://api.localhost
https://mcp.localhost
https://web.localhost
https://admin.localhost
https://docs.localhost
```

### Production URLs

```
https://studio.intel.dom.gob
https://api.intel.dom.gob
https://mcp.intel.dom.gob
https://web.intel.dom.gob
https://admin.intel.dom.gob
https://docs.intel.dom.gob
```

Only `DOMAIN` changes. Caddy auto-manages HTTPS via Let's Encrypt.

---

## Public Access

INTEL.DOM.GOB can be used **without self-hosting or an API key**. The platform runs in **public preview mode** by default:

- **No API key required** — all clients (Web, Admin, Studio v0 via SDK; Studio v1, CLI via MCP; MCP via SDK) work out of the box when `REQUIRE_API_KEY=false` (the development default).
- **Público tier** — 20 intelligence queries/day, no signup. Raw official data (institutions, SIL legislative data, knowledge graph reads) is always free and unmetered.
- **Beyond Público** — create API keys in the Admin console and set `REQUIRE_API_KEY=true`. The Investigador (200/day, free for `.gob.do`/researchers) and Pro (1,000+/day, paid) tiers unlock streaming, workflows, and document intelligence.

→ Full guide, tier table, and API-key walkthrough: **[docs/getting-started](./apps/docs/content/docs/getting-started.mdx)**

→ Product catalog (Studio, API, MCP, Web, CLI, Admin): **[docs/products](./apps/docs/content/docs/products.mdx)**

---

## Docker

Single canonical `docker-compose.yml`. No per-environment compose files.

```bash
docker compose up -d        # brings up api, studio, mcp, web, admin, docs, searxng, postgres, dragonfly, caddy + 5 workers
docker compose ps           # health-checked services
```

* Every container exposes `/health`, `/ready`, `/live`.
* Only Caddy publishes ports (80/443). All other services use internal Docker DNS.
* Services communicate by name: `api`, `searxng`, `postgres`, `dragonfly`.
* 5 async workers (OCR, embedding, document, crawler, AI) consume from DragonflyDB Streams.

---

## Scripts

All operational scripts live in `scripts/`:

| Script | Purpose |
|--------|---------|
| `up.sh` | Build + start the full stack, run health/endpoint checks, print service health |
| `setup.sh` | Validate prerequisites, install deps |
| `doctor.sh` | Prerequisite + health checks |
| `backup.sh` | Backup volumes (PostgreSQL + DragonflyDB) |
| `restore.sh` | Restore PostgreSQL |
| `lint.sh` | Typecheck all workspaces |
| `format.sh` | Format code |
| `test.sh` | Run tests |
| `clean.sh` | Remove build artifacts |
| `update.sh` | Update dependencies |
| `deploy.sh` | One-command production deploy |
| `banner.sh` | Display startup banner |
| `logs.sh` | Tail logs |
| `generate-iac.sh` | Generate IaC configs |
| `studio-up.sh` | Start the Studio (v1 / Odysseus) services; brings up the full platform first if the MCP server isn't running |
| `studio-down.sh` | Stop only the Studio services (or the whole stack with `--all`) |
| `studio-onboot.sh` | On-boot hook inside the Odysseus container: seeds setup, registers the INTEL.DOM.GOB MCP server by default, then starts the app |
| `discover-senate-dspace.ts` | One-off probe of the Senado DSpace API; writes `discover-senate-dspace-results.json` |

---

## Development

### Hot Reload in Docker (Recommended)

Full hot reload setup — edit any file and changes appear immediately without rebuilding:

```bash
# Start everything with hot reload
./scripts/dev.sh up

# Or manually
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

See **[DEVELOPMENT.md](./DEVELOPMENT.md)** for the complete guide.

### Local Development (No Docker)

Run services independently for fastest iteration:

```bash
npm install --workspaces
cd apps/api && npm run dev       # API on :4000
cd apps/studio/v0 && npm run dev  # Studio v0 on :5173 (Vite)
```

---

## Providers

Adding a provider requires **only** creating a new implementation:

```ts
// providers/brave/src/index.ts
import { createBraveProvider } from "@intel.dom.gob/providers";
export const brave = createBraveProvider({ apiKey: process.env.BRAVE_API_KEY });
```

Register it in `apps/api/src/index.ts`. Nothing else changes.

| Kind | Default | Optional |
|------|---------|----------|
| Search | SearXNG | Brave, Tavily, Exa |
| AI | Gemini | OpenAI, Anthropic, DeepSeek, Ollama |
| OCR | — | Unlimited-OCR |
| Presentation | — | HyperFrames |

---

## Services

Each service has exactly one responsibility and is independently testable:

* **Orchestrator** — agent execution, planning, search/AI orchestration, result merging, streaming.
* **Search** — web/news retrieval through the Search Provider.
* **AI** — model calls via the AI Provider.
* **Institutions** — 8 pluggable Dominican government sources (Senado, Cámara, Presidencia, Tribunal Constitucional, DGCP, Datos Abiertos, Consultoría Jurídica, Compras Públicas).
* **Crawler** — categorized URL-tree builder.
* **Auth** — API keys, JWT, organizations, RBAC/ABAC authorization.
* **Embeddings** — text embeddings with Gemini semantic model or hash fallback.
* **RAG** — retrieval-augmented generation over indexed documents.
* **Knowledge Graph** — entity-relationship graph over intelligence results.
* **Entities** — rule-based extraction of People, Organizations, Laws, Institutions, Dates, Locations.
* **Document Intelligence** — full pipeline: Storage → OCR → Text → Entities → Embeddings → Knowledge Graph.
* **Workflow** — DAG execution engine with retries, checkpoints, approvals, human-in-the-loop.
* **Tool Registry** — declarative, discoverable tools for agents / MCP.
* **Prompts** — versioned prompt templates with `{{var}}` rendering.
* **Evaluation** — answer faithfulness and quality scoring.
* **Observability** — in-process metrics + tracing with Prometheus export.
* **Tenancy** — multi-tenant resolution and data isolation.
* **Plugins** — guarded extension registry with timeout executor.
* **Storage** — object storage abstraction (local filesystem, pluggable S3/GCS).
* **OCR** — OCR delegation to the configured OcrProvider.
* **Scheduler** — in-process recurring/deferred job scheduler.
* **Memory** — structured codebase/architecture memory for AI agents.
* **Documents** — document chunking and boilerplate cleaning.
* **Presentation** — shareable presentation artifacts via PresentationProvider.
* **MCP** — MCP server (pure SDK client of the API, exposes tools over JSON-RPC + Streamable HTTP).

---

## API

Versioned REST (`/v1`). The API contains **no business logic** — every endpoint delegates to the Orchestrator or a Service.

> **Public-facing vs internal.** Every *public-facing* endpoint sits behind an API-key wall. With **no key** it runs as the **Público** preview tier; a **valid key** unlocks that key's tier (scopes, rate limit, daily quota). *Internal / infrastructure* endpoints (workflows, tool & plugin execution, prompt authoring, evaluation, tenant) require a valid key with the right scope and are **not** part of the public product surface. The Swagger UI and OpenAPI spec are **admin-only**. See **API Key Tiers** below.

### API Key Tiers (Suscripciones)

| Plan | Audience | Raw data | Intelligence queries | Streaming | Workflows / Document Intelligence | Price |
|---|---|---|---|---|---|---|
| **Público** | Anyone, no signup | Unlimited | 20/day | ❌ | ❌ | Free |
| **Investigador** | Verified journalists, researchers, academics, `.gob.do` | Unlimited | 200/day | ✅ | ❌ | Free |
| **Pro** | Businesses, law firms, analysts | Unlimited | 1,000/day included, metered overage | ✅ | ✅ | Flat fee/mo |
| **Institucional** | Ministries, large orgs, integrators | Unlimited | Custom | ✅ | ✅ + dedicated tenancy, SLA, priority workers | Custom contract |

- **No key → Público.** Preview runs with scopes `read, query, chat`, 20 queries/day, 10/min. No signup.
- **Valid key → that tier.** Keys are issued through the Admin console (`apps/admin`) bound to a plan; the gateway enforces the plan's scopes, rate limit, and daily quota.
- **Invalid / missing key on an internal endpoint → `401`.** Internal routes never fall back to preview.
- **Suspended or overdue payment → `402` hard block** on every metered request.
- **Swagger UI (`/v1/docs`) and OpenAPI (`/v1/openapi.json`) are admin-only** — not part of the public surface.
- Overage on Pro is billed per query at a fixed per-unit rate from `services/observability` usage events; usage is visible in real time via `GET /v1/tenant`.

### Core Endpoints

| Access | Method | Path | Description |
|--------|--------|------|-------------|
| Público | GET | `/v1/health` | Service health |
| Público | GET | `/v1/institutions` | Dynamic institution registry |
| Público | GET | `/v1/url-tree` | Categorized URL tree (`?refresh=1`, `?portals=`) |
| Público | POST | `/v1/query` | Multi-agent intelligence query |
| Público | POST | `/v1/query/stream` | Streaming query (SSE) |
| Público | POST | `/v1/chat` | Context-grounded follow-up chat |

### OpenAI-Compatible Endpoints

| Access | Method | Path | Description |
|--------|--------|------|-------------|
| Público | POST | `/v1/chat/completions` | OpenAI-compatible chat (sync + SSE streaming) |
| Público | GET | `/v1/models` | List available models |
| Público | POST | `/v1/embeddings` | Generate text embeddings |

### Intelligence Services

| Access | Method | Path | Description |
|--------|--------|------|-------------|
| Público | POST | `/v1/documents/process` | Full document intelligence pipeline |
| Público | POST | `/v1/entities/extract` | Extract entities from text |
| 🔒 Internal | POST | `/v1/graph/ingest` | Ingest IntelligenceResult into Knowledge Graph |
| Público | GET | `/v1/graph` | Query Knowledge Graph (`?entity=`) |

### Workflow Engine

| Access | Method | Path | Description |
|--------|--------|------|-------------|
| 🔒 Internal | POST | `/v1/workflows` | Define and execute a DAG workflow |
| 🔒 Internal | GET | `/v1/workflows/:id` | Get workflow state |
| 🔒 Internal | POST | `/v1/workflows/:id/approve` | Approve a paused step |
| 🔒 Internal | POST | `/v1/workflows/:id/deny` | Deny a paused step |

### Tools, Prompts, Evaluation, Plugins

| Access | Method | Path | Description |
|--------|--------|------|-------------|
| Público | GET | `/v1/tools` | List registered tools |
| 🔒 Internal | POST | `/v1/tools/:id/execute` | Execute a tool |
| Público | GET | `/v1/prompts` | List prompt templates |
| Público | GET | `/v1/prompts/:key` | Get prompt versions |
| 🔒 Internal | POST | `/v1/prompts` | Create/update prompt |
| Público | POST | `/v1/prompts/:key/render` | Render prompt with variables |
| 🔒 Internal | POST | `/v1/evaluate/faithfulness` | Evaluate answer faithfulness |
| 🔒 Internal | POST | `/v1/evaluate/quality` | Evaluate answer quality |
| Público | GET | `/v1/plugins` | List plugins |
| 🔒 Internal | POST | `/v1/plugins/:id/run` | Run a plugin |

### System

| Access | Method | Path | Description |
|--------|--------|------|-------------|
| 🔒 Internal | GET | `/v1/tenant` | Current tenant info |
| Público | GET | `/v1/metrics` | Prometheus metrics |
| Público | GET | `/v1/mcp/tools` | MCP server tool catalog |
| 🔒 Admin-only | GET | `/v1/docs` | Swagger UI |
| 🔒 Admin-only | GET | `/v1/openapi.json` | OpenAPI specification |

### Institution Direct Data (SIL)

| Access | Method | Path | Description |
|--------|--------|------|-------------|
| Público | GET | `/v1/sil/camara/iniciativas` | Cámara SIL initiatives |
| Público | GET | `/v1/sil/camara/comisiones` | Cámara committees |
| Público | GET | `/v1/sil/camara/comision/tipo` | Cámara committee types |
| Público | GET | `/v1/sil/camara/iniciativa/count` | Initiative count |
| Público | GET | `/v1/sil/camara/iniciativa/grupos` | Initiative topic groups |
| Público | GET | `/v1/sil/camara/iniciativa/materias` | Matters by topic group |
| Público | GET | `/v1/sil/camara/sesiones` | Cámara sessions |
| Público | GET | `/v1/sil/camara/grupos` | Parliamentary groups |
| Público | GET | `/v1/sil/camara/legislador` | Search legislators |
| Público | GET | `/v1/sil/senado/iniciativas` | Senado SIL initiatives |
| Público | GET | `/v1/sil/senado/boletines` | Senado bulletins |
| Público | GET | `/v1/sil/senado/resoluciones` | Senado resolutions |
| Público | GET | `/v1/senado/news` | Senado press/news |
| Público | GET | `/v1/sil/senado/search` | Senado DSpace full-text search |
| Público | GET | `/v1/sil/senado/communities` | Senado DSpace community tree |
| Público | GET | `/v1/sil/senado/collections/:id/items` | Senado collection items |

Clients reach the API through the SDK (`@intel.dom.gob/sdk`) — the single client surface. Web, Admin and Studio v0 import it directly; the MCP server imports it; Studio v1 and the CLI go through the MCP server (which itself is a pure SDK client), so they never import `@intel.dom.gob/sdk`.

---

## Studio

The active Studio is **IntelDomGob Studio** — our own AGPL-3.0 in-tree fork of [Odysseus](https://github.com/pewdiepie-archdaemon/odysseus) at `apps/studio/v1`. It communicates **exclusively** with the platform via the MCP server — it does not import the SDK. It contains no platform business logic.

The legacy React SPA at `apps/studio/v0` is preserved for rollback; unlike v1 it talks to the API directly through the SDK.

---

## MCP

The MCP server is just another client of the platform — it imports `@intel.dom.gob/sdk` and calls the API through it, never invoking providers or services directly. It exposes both a legacy JSON-RPC surface (`POST /`) and the official MCP protocol (`/mcp`, Streamable HTTP + SSE) with a shared tool registry. 20+ tools covering intelligence queries, SIL data, Senado DSpace, and institutional data. Studio v1 and the CLI connect here instead of importing the SDK directly.

---

## Event-Driven Workers

Heavy work is offloaded to async workers consuming from DragonflyDB Streams:

```
Service  →  Event Bus (DragonflyDB)  →  Worker
```

| Worker | Purpose |
|--------|---------|
| ocr-worker | Process document OCR via Unlimited-OCR |
| embedding-worker | Generate text embeddings |
| document-worker | Orchestrate the full document intelligence pipeline |
| crawler-worker | Build categorized URL trees |
| ai-worker | Heavy/batch AI generation tasks |

---

## Infrastructure as Code

| Tool | Location | Purpose |
|------|----------|---------|
| Terraform | `iac/terraform/` | Cloud infrastructure provisioning |
| Pulumi | `iac/pulumi/` | Infrastructure as code (TypeScript) |
| Helm | `iac/helm/` | Kubernetes deployment chart |

---

## Deployment

Single command, identical to local:

```bash
./scripts/deploy.sh
```

Internally: `git pull` → `docker compose pull` → `docker compose up -d --build` → health checks.

Suitable for self-hosting and cloud VPS without modification.

---

## Testing

105+ tests across 17 files covering:

* Unit tests: orchestrator assembly, provider contracts, AI service, embeddings, events, auth RBAC/ABAC, knowledge graph, OpenAI-compatible API, event bus + worker pipeline
* Integration tests: API ↔ Orchestrator ↔ Providers with DI mocks (supertest)
* End-to-End tests: real SDK client drives API with mocked orchestrator

```bash
npm test                     # all workspace tests
./scripts/test.sh            # test runner script
```

---

## Roadmap

* ✅ Event bus + async workers (DragonflyDB Streams)
* ✅ Knowledge Graph service
* ✅ Document Intelligence pipeline
* ✅ Workflow engine (DAG + HITL)
* ✅ Tool Registry + Prompt Service + Evaluation
* ✅ Observability (Prometheus metrics)
* ✅ Multi-tenancy + RBAC/ABAC
* ✅ Plugin system
* ✅ Infrastructure as Code (Terraform, Pulumi, Helm)
* 🟡 OAuth / Teams auth (JWT + API-key scopes exist)
* 🟡 WebSocket streaming (SSE covers current needs)
* ❌ Mobile apps / browser extension (future scope)

---

## FAQ

**Why a reverse proxy with subdomains instead of ports?**
Ports are a dev artifact. Production behaves like `studio.intel.dom.gob`, and development mirrors it exactly via `studio.localhost`. One mental model, zero config drift.

**Where does the AI key go?**
`DEFAULT_AI_API_KEY` in `.env` (never committed) — one key drives any provider selected by `DEFAULT_AI_PROVIDER`. The API also accepts a per-request `apiKey` for multi-tenant use.

**Is the existing SearXNG setup preserved?**
Yes — `docker/searxng/settings.yml` is the original anonymous JSON API configuration, mounted unchanged.

**Can I use local models?**
Yes. Set `DEFAULT_AI_PROVIDER=ollama` and `DEFAULT_BASE_URL=http://host.docker.internal:11434` in `.env`. Any OpenAI-compatible endpoint works.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md).

## License

MIT.

## Pricing

INTEL.DOM.GOB separates **public record access** from **intelligence synthesis**. Raw official data stays free and unmetered, permanently. What's metered is the compute-intensive layer we add on top: multi-agent reasoning, document intelligence, workflows, and knowledge graph synthesis.

> Official data is a public good. Synthesis is a paid service. We meter the second, never the first.

### What's always free

No API key, no quota, no rate limit beyond standard abuse protection:

| Category | Endpoints |
|---|---|
| Source registry | `/v1/institutions`, `/v1/url-tree` |
| SIL raw data | `/v1/sil/camara/*`, `/v1/sil/senado/*` |
| Public search | `/v1/senado/news`, `/v1/sil/senado/search`, `/v1/sil/senado/communities`, `/v1/sil/senado/collections/:id/items` |
| Knowledge graph (read) | `/v1/graph` |
| System | `/v1/health` (Swagger UI + OpenAPI spec are admin-only, not public) |

This is the transparency floor. It doesn't move, regardless of plan.

### What's metered

The Orchestrator's compute cost (AI provider calls, search provider calls, OCR, embeddings) lives behind these routes:

| Category | Endpoints |
|---|---|
| Intelligence queries | `/v1/query`, `/v1/query/stream`, `/v1/chat`, `/v1/chat/completions` |
| Document intelligence | `/v1/documents/process`, `/v1/entities/extract`, `/v1/graph/ingest` |
| Workflow engine | `/v1/workflows/*` |
| Embeddings & evaluation | `/v1/embeddings`, `/v1/evaluate/*` |
| Tools & plugins | `/v1/tools/:id/execute`, `/v1/plugins/:id/run` |

### Plans

| Plan | Audience | Raw data | Intelligence queries | Streaming | Workflows / Document Intelligence | Price |
|---|---|---|---|---|---|---|
| **Público** | Anyone, no signup | Unlimited | 20/day | ❌ | ❌ | Free |
| **Investigador** | Verified journalists, researchers, academics, `.gob.do` | Unlimited | 200/day | ✅ | ❌ | Free |
| **Pro** | Businesses, law firms, analysts | Unlimited | 1,000/day included, metered overage | ✅ | ✅ | Flat fee/mo |
| **Institucional** | Ministries, large orgs, integrators | Unlimited | Custom | ✅ | ✅ + dedicated tenancy, SLA, priority workers | Custom contract |

Overage on Pro is billed per query at a fixed per-unit rate, calculated from `services/observability` usage events — no surprise invoices, usage visible in real time via `/v1/tenant`.

### Verification for the Investigador tier

Free-but-full-strength access is granted on identity, not payment: `.gob.do` / accredited university domains auto-qualify; independent journalists and civil-society researchers apply for manual approval. This is the mechanism that keeps the free tier meaningful instead of symbolic — it's the FOI commitment made operational, not just a marketing line.

### Why this split

- **Raw public data was never ours to sell.** Charging for it would work against the Estado's own transparency mandate.
- **Synthesis has a real, variable cost** (LLM inference, search API calls, OCR compute) and scales with usage — this is what has to be sustainable for the platform to keep running and improving.
  - **Un mismo trato para todos.** Los planes y límites se aplican de la misma forma en cada producto (web, Studio, API, CLI, MCP).

Full plan details and the Investigador application form: `https://intel.dom.gob/pricing`.
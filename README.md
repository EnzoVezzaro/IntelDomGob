# INTEL.DOM.GOB

**Plataforma de Inteligencia Gubernamental del Estado Dominicano** — API-first, multi-agente, basada en evidencia oficial.

> El API es el producto. Todo lo demás es simplemente otro cliente.

---

## Vision

INTEL.DOM.GOB es una plataforma de inteligencia estatal impulsada por IA que realiza *deep research* en tiempo real sobre las fuentes oficiales de la República Dominicana. Cada consulta dispara un **bucle multi-agente de recuperación y razonamiento** que busca, lee, contrasta y sintetiza información oficial antes de responder.

La arquitectura gira en torno al **API**. Todo fluye a través de:

```
Cliente → API → Orchestrator → Services → Providers → External Systems
```

Ningún cliente habla directamente con servicios o proveedores.

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
Clients
─────────────────────────────────────────────
Studio · Web · CLI · Admin · MCP · SDKs

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
│   ├── studio/v0/        # Legacy React SPA client (preserved for rollback)
│   ├── studio/v1/        # Active Studio: Odysseus workspace (AGPL-3.0 submodule)
│   ├── web/              # Lightweight no-JS web client
│   ├── admin/            # Operator/admin console
│   └── cli/              # Command-line client
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
│   ├── sdk/              # the ONLY way clients talk to the API
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
├── docs/
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
cp .env.example .env          # set GEMINI_API_KEY, DOMAIN

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

---

## Development

Run services independently (no Docker needed for code changes):

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

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/health` | Service health |
| GET | `/v1/institutions` | Dynamic institution registry |
| GET | `/v1/url-tree` | Categorized URL tree (`?refresh=1`, `?portals=`) |
| POST | `/v1/query` | Multi-agent intelligence query |
| POST | `/v1/query/stream` | Streaming query (SSE) |
| POST | `/v1/chat` | Context-grounded follow-up chat |

### OpenAI-Compatible Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | OpenAI-compatible chat (sync + SSE streaming) |
| GET | `/v1/models` | List available models |
| POST | `/v1/embeddings` | Generate text embeddings |

### Intelligence Services

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/documents/process` | Full document intelligence pipeline |
| POST | `/v1/entities/extract` | Extract entities from text |
| POST | `/v1/graph/ingest` | Ingest IntelligenceResult into Knowledge Graph |
| GET | `/v1/graph` | Query Knowledge Graph (`?entity=`) |

### Workflow Engine

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/workflows` | Define and execute a DAG workflow |
| GET | `/v1/workflows/:id` | Get workflow state |
| POST | `/v1/workflows/:id/approve` | Approve a paused step |
| POST | `/v1/workflows/:id/deny` | Deny a paused step |

### Tools, Prompts, Evaluation, Plugins

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tools` | List registered tools |
| POST | `/v1/tools/:id/execute` | Execute a tool |
| GET | `/v1/prompts` | List prompt templates |
| GET | `/v1/prompts/:key` | Get prompt versions |
| POST | `/v1/prompts` | Create/update prompt |
| POST | `/v1/prompts/:key/render` | Render prompt with variables |
| POST | `/v1/evaluate/faithfulness` | Evaluate answer faithfulness |
| POST | `/v1/evaluate/quality` | Evaluate answer quality |
| GET | `/v1/plugins` | List plugins |
| POST | `/v1/plugins/:id/run` | Run a plugin |

### System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenant` | Current tenant info |
| GET | `/v1/metrics` | Prometheus metrics |
| GET | `/v1/mcp/tools` | MCP server tool catalog |
| GET | `/v1/docs` | Swagger UI |
| GET | `/v1/openapi.json` | OpenAPI specification |

### Institution Direct Data (SIL)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/sil/camara/iniciativas` | Cámara SIL initiatives |
| GET | `/v1/sil/camara/comisiones` | Cámara committees |
| GET | `/v1/sil/camara/comision/tipo` | Cámara committee types |
| GET | `/v1/sil/camara/iniciativa/count` | Initiative count |
| GET | `/v1/sil/camara/iniciativa/grupos` | Initiative topic groups |
| GET | `/v1/sil/camara/iniciativa/materias` | Matters by topic group |
| GET | `/v1/sil/camara/sesiones` | Cámara sessions |
| GET | `/v1/sil/camara/grupos` | Parliamentary groups |
| GET | `/v1/sil/camara/legislador` | Search legislators |
| GET | `/v1/sil/senado/iniciativas` | Senado SIL initiatives |
| GET | `/v1/sil/senado/boletines` | Senado bulletins |
| GET | `/v1/sil/senado/resoluciones` | Senado resolutions |
| GET | `/v1/senado/news` | Senado press/news |
| GET | `/v1/sil/senado/search` | Senado DSpace full-text search |
| GET | `/v1/sil/senado/communities` | Senado DSpace community tree |
| GET | `/v1/sil/senado/collections/:id/items` | Senado collection items |

All clients (Studio, CLI, MCP, SDKs) use `@intel.dom.gob/sdk`.

---

## Studio

The Studio is the primary application — built on Odysseus (AGPL-3.0 submodule at `apps/studio/v1`). It communicates **exclusively** with the platform via the MCP server. It contains no platform business logic.

The legacy React SPA is preserved at `apps/studio/v0` for reference/rollback.

---

## MCP

The MCP server is another client of the platform: it calls the API like any other client and never invokes providers or services directly. It exposes both a legacy JSON-RPC surface (`POST /`) and the official MCP protocol (`/mcp`, Streamable HTTP + SSE) with a shared tool registry. 20+ tools covering intelligence queries, SIL data, Senado DSpace, and institutional data.

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
`GEMINI_API_KEY` in `.env` (never committed). The API also accepts a per-request `apiKey` for multi-tenant use.

**Is the existing SearXNG setup preserved?**
Yes — `docker/searxng/settings.yml` is the original anonymous JSON API configuration, mounted unchanged.

**Can I use local models?**
Yes. Set `DEFAULT_AI_PROVIDER=ollama` and `OLLAMA_BASE_URL=http://host.docker.internal:11434` in `.env`. Any OpenAI-compatible endpoint works.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md).

## License

MIT.

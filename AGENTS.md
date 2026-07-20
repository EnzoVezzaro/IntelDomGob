# AGENTS.md — For AI Coding Agents

This document explains the architecture and the **rules that must never be broken** so that
future AI agents (and humans) can extend INTEL.DOM.GOB safely.

---

## The One Rule

```
Client → API → Orchestrator → Services → Providers → External Systems
```

Every request flows top-down. **Never skip a layer.**

* A client (Studio, CLI, MCP, SDK) **only** talks to the API.
* The API **only** delegates to the Orchestrator. No business logic in `apps/api`.
* The Orchestrator contains business logic and orchestrates Services.
* Services contain single-responsibility logic and call Providers.
* Providers are the **only** code that touches external systems (SearXNG, Gemini, …).

---

## Folder Responsibilities

| Path | Responsibility | May import |
|------|----------------|-----------|
| `packages/types` | Shared domain types (contract between all layers) | — |
| `packages/logger` | Structured logging (timestamp, service, level, requestId) | types |
| `packages/config` | Env configuration, validated at startup | types |
| `packages/utils` | Framework-agnostic helpers (text, fetch, dedupe) | types |
| `packages/sdk` | The ONLY client surface for talking to the API | types |
| `packages/database` | ORM-free Postgres pool + idempotent migrations | config, logger |
| `packages/events` | Event bus over DragonflyDB (Redis Streams) + in-memory fallback | logger |
| `packages/ui` | Shared brutalist Panel + Button primitives for UI clients | — |
| `providers/*` | Adapters to external systems (search, AI, OCR, presentation) | providers, packages |
| `services/orchestrator` | Multi-agent reasoning, result assembly, SSE streaming | everything below |
| `services/search` | Web/news retrieval via Search Provider | providers, packages |
| `services/ai` | Model calls via AI Provider | providers, packages |
| `services/institutions` | Pluggable DR government sources (8 plugins) | types, packages |
| `services/crawler` | URL-tree builder | packages |
| `services/auth` | API keys, JWT, orgs, RBAC/ABAC (identity & access) | database, logger |
| `services/embeddings` | Text embeddings + similarity (Gemini semantic, hash fallback) | logger |
| `services/rag` | Retrieval-augmented generation over indexed docs | embeddings, ai |
| `services/memory` | Structured codebase/architecture memory | logger |
| `services/documents` | Document chunking/cleaning | logger |
| `services/ocr` | OCR delegation to an OcrProvider | providers |
| `services/scheduler` | In-process job scheduler | logger |
| `services/evaluation` | Answer faithfulness / quality evaluators | types, logger |
| `services/storage` | Object storage abstraction (local fs, pluggable S3/GCS) | logger |
| `services/presentation` | Shareable presentation artifacts via PresentationProvider | providers |
| `services/knowledge-graph` | Entity-relationship graph over intelligence results | logger |
| `services/entities` | Rule-based entity extraction (People, Orgs, Laws, Institutions) | logger |
| `services/document-intelligence` | Full pipeline: Storage → OCR → Entities → Embeddings → KG | storage, ocr, entities, embeddings, knowledge-graph |
| `services/workflow` | DAG execution engine with retries, checkpoints, approvals/HITL | logger |
| `services/tool-registry` | Declarative, discoverable tools for agents / MCP | — |
| `services/prompts` | Versioned prompt templates with `{{var}}` rendering | — |
| `services/observability` | In-process metrics + tracing, Prometheus text export | logger |
| `services/tenancy` | Multi-tenant resolution + data isolation | service-auth |
| `services/plugins` | Guarded plugin extension registry with timeout executor | logger |
| `services/mcp` | MCP server — a pure SDK client of the API. Exposes BOTH a legacy JSON-RPC surface (`POST /`) and the official MCP protocol (`/mcp`, Streamable HTTP + SSE), reusing one tool registry. | sdk, logger |
| `apps/api` | Express gateway, routes, health, OpenAPI, SSE, rate-limit | services, providers, packages |
| `apps/studio/v0` | Legacy React SPA client (preserved for rollback) | sdk, types |
| `apps/studio/v1` | **Active Studio UI** — IntelDomGob Studio, our AGPL-3.0 fork of the Odysseus workspace (no longer synced from upstream; owned and customized in-tree). Connects to the platform ONLY via the MCP server. Kept separate from the MIT platform code. | — |
| `apps/web` | Lightweight no-JS web client (SDK only) | sdk, logger |
| `apps/admin` | Operator/admin console (SDK only) | sdk, logger |
| `apps/cli` | Command-line client (SDK only) | sdk |
| `workers/ocr-worker` | Async OCR processing via DragonflyDB Streams event bus | — |
| `workers/embedding-worker` | Async embedding generation via event bus | — |
| `workers/document-worker` | Async document intelligence pipeline via event bus | — |
| `workers/crawler-worker` | Async URL-tree crawling via event bus | — |
| `workers/ai-worker` | Async AI generation tasks via event bus | — |

---

## Dependency Rules

1. Arrows point downward. A lower layer **must never** import from a higher layer.
   * `services/*` must NOT import from `apps/*`.
   * `providers/*` must NOT import from `services/*` or `apps/*`.
   * `packages/*` must NOT import from anything above it (zero deps on other workspace pkgs except `types`).
2. The **only** cross-layer exception: `packages/sdk` is imported by clients (`apps/*`, future MCP/CLI).
3. No circular dependencies between services.

---

## Naming & Coding Conventions

* TypeScript, ESM, `strict` off but `noImplicitAny` respected; prefer explicit types from `packages/types`.
* Service classes are named `<Capability>Service` (e.g. `SearchService`, `AiService`).
* Provider classes implement `SearchProvider` / `AiProvider` / `OcrProvider` / `PresentationProvider` from `@intel.dom.gob/providers`.
* Every log line uses `createLogger("<layer>:<concern>")`.
* Never duplicate logic that already lives in `packages/utils` or `packages/*`.

---

## Provider Architecture

```ts
// providers/<name>/src/index.ts
export class XProvider implements SearchProvider | AiProvider | OcrProvider | PresentationProvider {
  id: string; kind: "search" | "ai" | "ocr" | "presentation"; label: string; enabled = true;
  // implement search() / generate() / extractText() / render()
}
```

* Provider contracts live in `providers/src/index.ts`: `SearchProvider`, `AiProvider` (with optional `stream()`), `OcrProvider`, `PresentationProvider`, plus a `ProviderRegistry` with `registerSearch/registerAi/registerOcr/registerPresentation`.
* Register in `apps/api/src/index.ts`. Optional providers (OpenAI, Anthropic, Unlimited-OCR, Brave, Tavily, Exa, DeepSeek, Ollama) are registered only when their env keys/URLs are present, so missing keys never crash boot.
* The default providers are **SearXNG** (search) and **Gemini** (AI, with `stream()`).
* A new provider is invisible to the rest of the platform — it only plugs into the registry.

### Currently Registered Providers

| Kind | Provider | Default | Env Var |
|------|----------|---------|---------|
| Search | SearXNG | ✅ | — (always on) |
| Search | Brave | optional | `BRAVE_API_KEY` |
| Search | Tavily | optional | `TAVILY_API_KEY` |
| Search | Exa | optional | `EXA_API_KEY` |
| AI | Gemini | ✅ | `GEMINI_API_KEY` |
| AI | OpenAI | optional | `OPENAI_API_KEY` |
| AI | Anthropic | optional | `ANTHROPIC_API_KEY` |
| AI | DeepSeek | optional | `DEEPSEEK_API_KEY` |
| AI | Ollama | optional | `OLLAMA_BASE_URL` |
| OCR | Unlimited-OCR | optional | `UNLIMITED_OCR_URL` |
| Presentation | HyperFrames | optional | `HYPERFRAMES_URL` |

---

## How to add a Search Provider

1. `mkdir providers/brave`, add `package.json` depending on `@intel.dom.gob/providers`.
2. Implement `SearchProvider.search()`.
3. Register it in `apps/api/src/index.ts`.
4. Add `"brave"` to `SEARCH_PROVIDERS` in `.env`.

Nothing else changes.

---

## How to add an AI Provider

1. `mkdir providers/openai`, implement `AiProvider.generate()` (and `stream()` optionally).
2. Register in `apps/api/src/index.ts`.
3. Add `"openai"` to `AI_PROVIDERS` / set `DEFAULT_AI_PROVIDER`.

---

## How to add an Institution (Service plugin)

1. Create `services/institutions/src/<id>/` with a class implementing `InstitutionService`.
2. Import + `registerInstitution(...)` in `services/institutions/src/index.ts`.
3. The UI discovers it automatically via `GET /v1/institutions`.

No other file changes.

---

## How to add an API Endpoint

1. Add a route in `apps/api/src/routes.ts` under the `/v1` router.
2. Delegate to the Orchestrator or a Service. **No business logic in the route.**
3. Document it in the docs site (`apps/docs/content/docs/api/`).

---

## How to add an MCP Tool

1. The MCP server is a client — call the API via `@intel.dom.gob/sdk`.
2. Do NOT call services/providers directly from MCP code.
3. Register the tool in `services/mcp/src/index.ts` via `registerTool({...})`.
4. Tool `annotations` (title, readOnlyHint, etc.) follow the MCP 2025-03-26 spec.

---

## How to add a Workflow Step

1. POST to `/v1/workflows` with a `name` and `steps` array.
2. Each step declares `id`, optional `deps` (step ids that must complete first), `action` + `params` (resolved server-side by the engine adapter), optional `requiresApproval`, `retries`, `timeoutMs`.
3. Steps with `requiresApproval: true` pause the workflow and emit `workflow.approval_requested`. Call `POST /v1/workflows/:id/approve` or `/deny` to resume/abort.
4. The engine topologically sorts steps (Kahn's algorithm), executes with retries + backoff, and checkpoints state.

---

## How to add a Plugin

1. Implement the `Plugin` interface from `services/plugins` with a `manifest` and `invoke`.
2. Register it with `plugins.register(plugin)` at boot.
3. Discoverable via `GET /v1/plugins`, invokable via `POST /v1/plugins/:id/run`.

---

## How to add Docker Services

1. Add a service block to `docker-compose.yml`.
2. Expose only internal ports; never publish to the host.
3. Add a `healthcheck`.
4. Let Caddy route it via a subdomain in `docker/caddy/Caddyfile`.

---

## Rules That Must NEVER Be Broken

* ❌ No client imports a service or provider directly.
* ❌ No business logic in `apps/api` routes.
* ❌ No external system call outside `providers/*`.
* ❌ No hardcoded ports in client URLs — use subdomains via the SDK resolver.
* ❌ No `docker-compose.*.yml` split by environment — one `docker-compose.yml`.
* ❌ No secrets committed — `.env` only, `GEMINI_API_KEY` never in code.
* ❌ No duplication of utilities already in `packages/*`.
* ❌ Never remove or alter `docker/searxng/settings.yml` behavior (preserved infrastructure).

---

## Studio (Web Application)

The active Studio UI is **IntelDomGob Studio** (`apps/studio/v1`), our own
**AGPL-3.0 fork of [Odysseus](https://github.com/pewdiepie-archdaemon/odysseus)**
(a self-hosted AI workspace). It is kept **separate from the MIT platform code**
and is licensed under AGPL-3.0, matching its upstream.

* **This is now an owned in-tree fork, not an upstream-synced submodule.** We have
  customized/rebranded it and no longer pull changes from Odysseus. Attribution to
  Odysseus and the AGPL license are preserved (see `apps/studio/v1/ACKNOWLEDGMENTS.md`
  and `apps/studio/v1/LICENSE`) to meet our AGPL obligations. Changes are made
  directly in `apps/studio/v1`.
* Branding is centralized: set `APP_NAME` in the Studio `.env` (drives the product
  name via `BRAND_NAME` in `apps/studio/v1/src/constants.py`). Internal identifiers
  (env vars, HTTP headers, DB collections, data paths) intentionally keep their
  original names for stability.
* It runs as its own docker services (`odysseus`, `studio-chromadb`, `studio-searxng`,
  `studio-ntfy`) on a dedicated `studio-net` network so it never touches the
  platform's `searxng` service. (The `odysseus` compose service name is kept as an
  identifier.)
* The Studio connects to INTEL.DOM.GOB **only via the MCP server** (`mcp:4100/mcp`).
  The INTEL.DOM.GOB MCP server is registered automatically on first boot by the
  on-boot hook (`scripts/studio-onboot.sh`, mounted into the Studio container).
* The previous React SPA is preserved at `apps/studio/v0` (served at `studio/v0.<DOMAIN>`)
  for reference / rollback.
* Studio customizations belong directly in `apps/studio/v1` — never mixed into the
  MIT `packages/*` or `services/*` code.

---

## Event Bus & Workers

Heavy work (OCR, embeddings, crawling, batch AI) is offloaded to async workers via
DragonflyDB (Redis-compatible) Streams:

```
API / Service  →  Event Bus (DragonflyDB)  →  Worker Consumer
```

Canonical events: `document.uploaded`, `ocr.started/completed`, `embedding.started/completed`,
`entity.extracted`, `document.intelligence.completed`, `crawl.completed`, `workflow.*`.

Workers run as independent Docker Compose services. Each consumes from specific event channels.
When no DragonflyDB is available, the event bus falls back to in-memory publish/subscribe.

---

## Workflow Engine

The workflow engine (`services/workflow`) executes multi-step intelligence pipelines as a DAG:

* **Steps** have `id`, `deps`, `run`, `retries`, `timeoutMs`, `requiresApproval`.
* **Topological ordering** (Kahn's algorithm) ensures dependencies execute first.
* **Human-in-the-loop**: steps with `requiresApproval` pause the workflow and emit
  `workflow.approval_requested`. Call `approve()` or `deny()` to resume/abort.
* **Checkpoints**: workflow state is persisted in-memory (swap for DB later).
* API: `POST /v1/workflows`, `GET /v1/workflows/:id`, `POST /v1/workflows/:id/approve`, `POST /v1/workflows/:id/deny`.

---

## Local vs Production

Identical stack. Only `DOMAIN` differs:

* `DOMAIN=localhost` → `http://studio.localhost`, `http://api.localhost`
* `DOMAIN=intel.dom.gob` → `https://studio.intel.dom.gob`, `https://api.intel.dom.gob`

Caddy handles routing and HTTPS in both.

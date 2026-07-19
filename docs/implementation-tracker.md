# Implementation Tracker — INTEL.DOM.GOB vs WORK.md

> Living document. Updated as work progresses. Goal: 100% WORK.md coverage with
> a fully working platform and meaningful tests.

Legend: ✅ done · 🟡 partial · ❌ missing

## Clients
- ✅ Studio (React SPA, API-only)
- ✅ MCP server (SDK client, pluggable tools)
- ✅ Web (no-JS SDK client)
- ✅ CLI (SDK client: query/chat/institutions)
- ✅ Admin (SDK client)
- ❌ Mobile Apps / Browser Extension (future, out of scope)

## Studio responsibilities (WORK.md #STUDIO)
- ✅ Chat
- ✅ AI Agent Interface
- ✅ Conversations (in-memory)
- ✅ Prompt Library (templates + localStorage persistence + send-to-console)
- ✅ Prompt Variables (per-template + global variables, `{{var}}` interpolation)
- ✅ History (localStorage)
- ✅ Tool Browser (lists API OpenAPI operations via `/v1/openapi.json`)
- ✅ MCP Browser (lists MCP server tools via `/v1/mcp/tools`)
- ✅ Knowledge Graph Browser (lists entities + neighborhood via `/v1/graph`)
- ✅ Provider Selection (settings)
- ✅ Authentication (UI): API-key field in Settings, persisted to localStorage, forwarded as bearer token; header shows SIN API KEY / API KEY OK
- ✅ Streaming Responses (SSE wired: `useStreaming` toggle → `apiClient.queryStream`, live token rendering + planner banner)

## API (WORK.md #API)
- ✅ REST API (/v1)
- ✅ Streaming (SSE) — POST /v1/query/stream
- ❌ WebSockets (not implemented)
- 🟡 Authentication (auth service + optional API-key gate; not default-on)
- 🟡 Authorization (API-key scopes exist; not enforced)
- ✅ API Keys (service implemented)
- ✅ Rate Limiting (express-rate-limit)
- ✅ OpenAPI Documentation (/v1/openapi.json + /v1/docs Swagger UI)
- ✅ MCP tool catalog endpoint (/v1/mcp/tools) — documents MCP server tools for clients
- ✅ Validation (manual per-route)
- ✅ Versioning (/v1)
- ✅ Request Routing
- ✅ No business logic in routes (all delegates to Orchestrator)

## Orchestrator (WORK.md #ORCHESTRATOR)
- ✅ Agent execution / search orchestration / AI orchestration
- ✅ Planning (DeerFlow-style lightweight planner step: intent + sub-questions + institution focus, deterministic, zero extra latency; surfaced in `planner.plan`)
- ✅ Prompt execution / result merging / context management
- ❌ Tool execution framework
- ❌ Workflow execution engine (DeerFlow-style planner/graph)
- 🟡 MCP routing (MCP is a separate client; orchestrator doesn't route to it)
- ✅ Streaming variant (runQueryStream)
- ✅ Provider selection (QueryRequest.provider resolves from ProviderRegistry; apiKey still supported)

## Services (WORK.md #SERVICES)
- ✅ search, ai, mcp, documents, embeddings, rag, crawler, evaluation,
       scheduler, storage, auth, ocr, memory, presentation, orchestrator, institutions
- ✅ Each independently testable (no cross-service impl coupling)

## Providers (WORK.md #PROVIDERS)
- ✅ SearXNG (search, default)
- ✅ Gemini (ai, default, stream())
- ✅ OpenAI, Anthropic (ai; registered when keys present)
- ✅ Brave, Tavily, Exa (search; registered when their API keys are present)
- ✅ Ollama, DeepSeek (ai; Ollama when OLLAMA_BASE_URL present, DeepSeek when DEEPSEEK_API_KEY present; both implement stream())
- ✅ Unlimited-OCR (ocr provider)
- ✅ HyperFrames (presentation provider)
- ✅ ProviderRegistry + add-provider-without-changes rule (6 search + 5 ai providers wired)

## MCP (WORK.md #MCP)
- ✅ SDK client; ✅ pluggable tools; adding a tool doesn't touch core infra

## Database (WORK.md #DATABASE)
- ✅ Abstraction + 12-table idempotent migration (users, organizations, api_keys,
       providers, conversations, prompts, agents, workflows, usage, billing,
       mcp_servers, tool_registry)

## Authentication (WORK.md #AUTHENTICATION)
- ✅ JWT (verify), API Keys (hashed), Organizations, (permissions via scopes)
- ❌ OAuth, Teams

## OpenAPI (WORK.md)
- ✅ auto-generated, versioned, every /v1 endpoint documented

## Streaming (WORK.md #STREAMING)
- ✅ SSE; ✅ streaming AI responses (token events); ✅ streaming search progress (plan/search events)
- ❌ WebSockets; ❌ streaming tool execution (no tool framework yet)

## Testing (WORK.md #TESTING)
- ✅ Unit tests (orchestrator assembly, provider contract, AI service, embeddings, events, auth RBAC/ABAC) — vitest, passing
- ✅ Integration tests (api↔orchestrator↔providers with DI mocks via supertest) — passing
- ✅ End-to-End tests (real SDK client drives API with mocked orchestrator) — passing
- ✅ Knowledge Graph service tests — passing
- ✅ OpenAI-compatible API tests (chat/completions, models, embeddings) — passing
- ✅ Event bus + worker pipeline tests — passing
- Total: 49 passing tests across 9 files

## Authentication & Authorization (WORK.md #AUTHENTICATION, #PERMISSION MODEL)
- ✅ JWT (verify), API Keys (hashed), Organizations, permissions via scopes
- ✅ RBAC: scope enforcement on API endpoints (query/chat/read) via AuthService.authorize
- ✅ ABAC: attribute constraints (e.g. clearance, department) deny-by-default
- ❌ OAuth, Teams

## OpenAI-compatible API (WORK.md #OPENAI COMPATIBLE API)
- ✅ POST /v1/chat/completions (sync + SSE streaming)
- ✅ GET /v1/models
- ✅ POST /v1/embeddings
- ✅ extensions: MCP tools, government sources, RAG, knowledge graph hooks

## Event Bus & Workers (WORK.md #EVENT / QUEUE ARCHITECTURE, #WORKER ARCHITECTURE)
- ✅ packages/events: EventBus over DragonflyDB (Redis-compatible) Streams + in-memory fallback
- ✅ Canonical events: document.uploaded, ocr.started/completed, embedding.started/completed, entity.extracted, document.intelligence.completed, workflow.* , crawl.completed
- ✅ workers/: ocr-worker, embedding-worker, document-worker, crawler-worker, ai-worker (compose services + Dockerfile)
- ✅ DragonflyDB replaces Redis as the broker (faster, memory-efficient, same protocol)
- ✅ Real embeddings: Gemini text-embedding-004 when key present, hash fallback otherwise

## Core hardening (Phase 0)
- ✅ Removed direct provider instantiation in API routes and orchestrator streaming (now via AiService.resolveProvider / chatFromContext)
- ✅ Real embeddings wired into RagService + /v1/embeddings endpoint
- ✅ RBAC/ABAC enforced at the API gateway level
- ✅ Full unit/integration test coverage for AI, embeddings, events, auth, OpenAI-compat

## Documentation (WORK.md #DOCUMENTATION)
- ✅ README, AGENTS, CONTRIBUTING, CHANGELOG, docs/ (architecture, api, adr,
       migration-report, repo-tree)
- ✅ README covers Vision/Architecture/Layout/Quick Start/Docker/Scripts/
       Development/Providers/Services/API/MCP/Studio/Deployment/Roadmap/FAQ/
       Contributing/License

## Scripts (WORK.md #SCRIPTS)
- ✅ setup, start, stop, restart, logs, doctor, backup, restore, lint, format,
       test, clean, update, deploy, init (logo preserved)

## Shared packages (WORK.md #SHARED)
- ✅ types, logger, config, utils, sdk, database
- ✅ ui (@intel.dom.gob/ui): shared brutalist Panel + Button primitives, used by Studio modules

## Config / Logging / Docker
- ✅ .env.example; ✅ validated at startup; ✅ no secrets committed
- ✅ structured logging (timestamp, service, level, requestId, message) + JSON in prod
- ✅ single docker-compose.yml; ✅ Caddy subdomains + HTTPS; ✅ healthchecks;
       ✅ internal DNS; ✅ /health /ready /live on api

## External integrations (WORK.md)
- ✅ Unlimited-OCR (ocr service + provider)
- 🟡 HyperFrames (presentation service + provider; needs external service to run)
- 🟡 DeerFlow ideas (orchestrator streaming exists; no full planner graph)
- 🟡 codebase-memory-mcp (memory service exists; not seeded/connected)

## Recommended architecture additions
- ✅ Knowledge Graph Service (`services/knowledge-graph`): extracts entities/relations from IntelligenceResult, pluggable GraphStore (in-memory default), `/v1/graph` + `/v1/graph/ingest` endpoints, SDK `graph()`/`graphIngest()`, Studio Knowledge Graph Browser
- ✅ Entities Service (`services/entities`): rule-based extraction of People/Organizations/Laws/Institutions/Dates/Locations + relations (creates/amends/...) from text
- ✅ Document Intelligence Service (`services/document-intelligence`): orchestrates Upload→Storage→OCR→Text→Classification→Metadata→Entities→Embedding→Knowledge Graph; emits pipeline events
- ✅ API: POST /v1/documents/process, POST /v1/entities/extract (scope-gated)

## Deliverables (WORK.md #DELIVERABLES)
- ✅ 1 Repository tree (docs/repo-tree.md)
- ✅ 2 Architecture diagram (docs/architecture.md)
- ✅ 3 Migration report (docs/migration-report.md)
- ✅ 4 Architectural decisions (docs/adr.md)
- ✅ 5 Future extension points (docs/adr.md + README)
- ✅ 6 Remaining technical debt (docs/migration-report.md)
- ✅ 7 Production recommendations (docs/migration-report.md)

## Current iteration priorities (all done)
1. ✅ Studio: SSE streaming, Prompt Library + Variables, Tool Browser, MCP Browser, Knowledge Graph Browser, Auth UI.
2. ✅ Tests: integration (supertest + DI mocks) + e2e (real SDK → API) + knowledge-graph; 16 passing.
3. ✅ Providers: Brave/Tavily/Exa (search) + Ollama/DeepSeek (ai) wired via ProviderRegistry (env-gated).
4. ✅ Orchestrator: DeerFlow-style planner step before retrieval; provider selection via QueryRequest.provider.
5. ✅ Knowledge Graph service + API + SDK + Studio browser.
6. ✅ Shared `ui` package with Panel/Button primitives used by Studio modules.

### Remaining gaps (lower priority / out of original scope)
- WebSocket streaming (SSE covers current needs).
- Full OAuth/Teams auth (JWT + API-key scopes exist).
- Mobile apps / browser extension (explicitly future scope in WORK.md).

## Operating-system hardening (post-architect-review)
- ✅ Phase 0: removed direct provider instantiation in api routes/orchestrator; AiService.chatFromContext/streamChat/resolveProvider; real embeddings; OpenAI-compatible endpoints; RBAC/ABAC deny-by-default.
- ✅ Phase 1: Event Bus (packages/events, DragonflyDB Streams + in-memory fallback) + 5 workers (ocr/embedding/document/crawler/ai) wired in docker-compose.
- ✅ Phase 2: Entities + Document Intelligence services + API endpoints.
- ✅ Phase 3: Workflow Engine (services/workflow): DAG, retries, checkpoints, approval/HITL; API /v1/workflows + approve/deny.
- ✅ Phase 4: Tool Registry (services/tool-registry) + Prompt Service (services/prompts); API /v1/tools, /v1/tools/:id/execute, /v1/prompts.
- ✅ Phase 5: Evaluation Service (services/evaluation): faithfulness + quality; API /v1/evaluate/*.
- ✅ Phase 6: Observability Service (services/observability): metrics + spans, Prometheus export; /v1/metrics + /metrics.
- ✅ Phase 7: Multi-tenancy (services/tenancy + tenants table + tenant_id on api_keys) + RBAC/ABAC tenant expansion in services/auth; X-Tenant-Id resolution in API; /v1/tenant.
- ✅ Phase 8: Plugins (services/plugins: registry + guarded executor); API /v1/plugins + /v1/plugins/:id/run. IaC: iac/terraform, iac/helm, iac/pulumi, scripts/generate-iac.sh.
- ✅ Operational: `scripts/up.sh` builds + starts the full stack, waits for health, runs live endpoint/infra checks (Postgres, DragonflyDB, event-bus round-trip, Prometheus metrics) and prints a health presentation. Verified end-to-end: ALL CHECKS PASSED (16/16). Fixed DragonflyDB memory footprint for Docker Desktop (`--proactor_threads 1 --maxmemory 256mb`).

### Final acceptance
- ✅ All workspace packages/services/apps covered by tests; full suite passing (105 tests, 17 files).
- ✅ Workspace-wide tsc --noEmit clean.


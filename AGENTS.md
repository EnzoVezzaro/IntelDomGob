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
| `providers/*` | Adapters to external systems (search, AI, OCR, presentation) | providers, packages |
| `services/orchestrator` | Multi-agent reasoning, result assembly, SSE streaming | everything below |
| `services/search` | Web/news retrieval via Search Provider | providers, packages |
| `services/ai` | Model calls via AI Provider | providers, packages |
| `services/institutions` | Pluggable DR government sources | types, packages |
| `services/crawler` | URL-tree builder | packages |
| `services/auth` | API keys, JWT, orgs (identity & access) | database, logger |
| `services/embeddings` | Text embeddings + similarity | logger |
| `services/rag` | Retrieval-augmented generation over indexed docs | embeddings, ai |
| `services/memory` | Structured codebase/architecture memory | logger |
| `services/documents` | Document chunking/cleaning | logger |
| `services/ocr` | OCR delegation to an OcrProvider | providers |
| `services/scheduler` | In-process job scheduler | logger |
| `services/evaluation` | Answer faithfulness / quality evaluators | types, logger |
| `services/storage` | Object storage abstraction | logger |
| `services/presentation` | Shareable presentation artifacts | providers |
| `services/mcp` | MCP server — a pure SDK client of the API. Exposes BOTH a legacy JSON-RPC surface (`POST /`) and the official MCP protocol (`/mcp`, Streamable HTTP + SSE), reusing one tool registry. | sdk, logger |
| `apps/api` | Express gateway, routes, health, OpenAPI, SSE, rate-limit | services, providers, packages |
| `apps/studio/v0` | Legacy React SPA client (preserved for rollback) | sdk, types |
| `apps/studio/v1` | **Active Studio UI** — vendored Odysseus workspace (git submodule, AGPL-3.0). Connects to the platform ONLY via the MCP server. Custom skin lives in its own fork/overlay, never mixed with MIT platform code. | — |
| `apps/web` | Lightweight no-JS web client (SDK only) | sdk, logger |
| `apps/admin` | Operator/admin console (SDK only) | sdk, logger |
| `apps/cli` | Command-line client (SDK only) | sdk |

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
* Provider classes implement `SearchProvider` / `AiProvider` from `@intel.dom.gob/providers`.
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
* Register in `apps/api/src/index.ts`. Optional providers (OpenAI, Anthropic, Unlimited-OCR) are registered only when their env keys/URLs are present, so missing keys never crash boot.
* The default providers are **SearXNG** (search) and **Gemini** (AI, with `stream()`).
* A new provider is invisible to the rest of the platform — it only plugs into the registry.

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
3. Document it in `README.md` and `docs/api.md`.

---

## How to add an MCP Tool

1. The MCP server is a client — call the API via `@intel.dom.gob/sdk`.
2. Do NOT call services/providers directly from MCP code.
3. Register the tool in the MCP server's tool registry (future).

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

The active Studio UI is **Odysseus** (https://github.com/odysseus-dev/odysseus), vendored
as a git submodule at `apps/studio/v1` (AGPL-3.0 — kept separate from the MIT platform code).

* Odysseus is an upstream self-hosted workspace, not platform code. It runs as its own
  docker services (`odysseus`, `studio-chromadb`, `studio-searxng`, `studio-ntfy`) on a
  dedicated `studio-net` network so it never touches the platform's `searxng` service.
* The Studio connects to INTEL.DOM.GOB **only via the MCP server** (`mcp:4100/mcp`).
  The INTEL.DOM.GOB MCP server is registered automatically on first boot by the
  on-boot hook (`scripts/studio-onboot.sh`, mounted into the odysseus container).
* The previous React SPA is preserved at `apps/studio/v0` (served at `studio/v0.<DOMAIN>`)
  for reference / rollback.
* Custom "skin" work belongs in the Odysseus submodule fork/overlay — never mixed into the
  MIT `packages/*` or `services/*` code.

---

## Local vs Production

Identical stack. Only `DOMAIN` differs:

* `DOMAIN=localhost` → `http://studio.localhost`, `http://api.localhost`
* `DOMAIN=intel.dom.gob` → `https://studio.intel.dom.gob`, `https://api.intel.dom.gob`

Caddy handles routing and HTTPS in both.

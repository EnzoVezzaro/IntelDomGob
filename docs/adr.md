# Architectural Decision Records (ADR)

## ADR-001 — API-first, layered architecture
**Decision:** Every request flows `Client → API → Orchestrator → Services → Providers → External`.
No client talks to services/providers; the API delegates all logic to the Orchestrator.
**Rationale:** Matches the "API is the product" vision; maximizes extensibility and
testability; lets any future client (mobile, CLI, third-party) integrate without touching
core logic.
**Consequence:** The API gateway is thin; business logic lives in the Orchestrator.

## ADR-002 — npm workspaces monorepo
**Decision:** Use npm workspaces (not pnpm/lerna) with `@intel.dom.gob/*` scoped packages.
**Rationale:** Zero extra tooling, native `npm install --workspaces`, works on the existing
Node 22 stack. Each layer is an independently typecheckable, publishable package.

## ADR-003 — Providers behind a registry
**Decision:** `SearchProvider`/`AiProvider` interfaces + a `ProviderRegistry`. Defaults are
SearXNG (search) and Gemini (AI).
**Rationale:** New vendors (Brave, OpenAI, Ollama) become drop-in implementations. The rest
of the platform is vendor-agnostic.
**Consequence:** Services depend on the interface, never on a concrete provider.

## ADR-004 — Institutions as pluggable services
**Decision:** Each DR government source implements `InstitutionService` and self-registers.
The UI discovers them via `GET /v1/institutions`.
**Rationale:** Adding a source (e.g. Suprema Corte, OMS) is a single new folder + one import.
No route, UI, or orchestrator change.
**Consequence:** Orchestrator iterates the registry instead of hardcoding sources.

## ADR-005 — Deterministic result assembly
**Decision:** The model's JSON output is merged with the REAL retrieved data in
`buildResult()`; UI streams are built from the retrieved pool, not the model's picks.
**Rationale:** Prevents hallucinated or missing sources in the evidence matrix and FLUJOs.
The AI reasons over evidence but the platform owns truth.

## ADR-006 — Caddy reverse proxy + subdomains
**Decision:** Caddy routes `studio.<DOMAIN>`, `api.<DOMAIN>`, `docs.<DOMAIN>`; auto-HTTPS.
**Rationale:** "Develop exactly like production" — only `DOMAIN` differs. No port-based
routing in production.
**Consequence:** Clients resolve the API base URL from the current origin's subdomain.

## ADR-007 — Single docker-compose.yml
**Decision:** One compose file for dev and prod; behavior changes via env vars only.
**Rationale:** Avoids config drift and the `docker-compose.*.yml` split anti-pattern.
**Consequence:** `scripts/deploy.sh` is essentially `docker compose up -d --build`.

## ADR-008 — Preserve SearXNG settings exactly
**Decision:** Mount the original `docker/searxng/settings.yml` (anonymous JSON API) unchanged.
**Rationale:** It is working, local-only infrastructure; the refactor must not break it.

## ADR-009 — SDK is the only client surface
**Decision:** `@intel.dom.gob/sdk` wraps every API call; Studio/CLI/MCP import it.
**Rationale:** Centralizes endpoint URLs, versioning, auth, and error handling. Clients
never hardcode `fetch` to the API.

## ADR-010 — Strict-off, noUncheckedIndexedAccess-off TypeScript
**Decision:** The base tsconfig does not enable `strict`/`noUncheckedIndexedAccess` (matching
the original app) but keeps `noImplicitAny` and explicit typing from `packages/types`.
**Rationale:** Keeps the large ported reasoning code readable and avoids noise, while
preserving type safety through the shared contract.

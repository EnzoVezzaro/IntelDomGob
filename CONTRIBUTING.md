# Contributing to INTEL.DOM.GOB

Thanks for helping build the open-source reference implementation for AI-powered
Government Intelligence.

## Philosophy

* **The API is the product.** Every feature integrates through it.
* **Develop exactly like production.** Same Docker Compose, subdomains, no port hacks.
* **Clean Architecture.** Separation of Concerns, Testability, Extensibility.
* **No business logic in clients or the API gateway.**

## Getting Started

```bash
cp .env.example .env
./scripts/init.sh
./scripts/start.sh
```

## Workflow

1. Create a branch from `main`.
2. Make changes following the layered architecture in `AGENTS.md`.
3. `./scripts/lint.sh` must pass (typecheck across all workspaces).
4. Add/adjust tests under the relevant `services/*` or `packages/*`.
5. Update docs (`README.md`, `docs/`) for API/provider/service changes.
6. Open a PR with a clear description and the rationale.

## Adding capabilities

| What | Where | Rule |
|------|-------|------|
| New external system | `providers/<name>` | Implement `SearchProvider`/`AiProvider`, register in `apps/api` |
| New government source | `services/institutions/src/<id>` | Implement `InstitutionService`, register in index |
| New endpoint | `apps/api/src/routes.ts` | Delegate to Orchestrator/Service, no logic in route |
| New shared helper | `packages/utils` | No runtime deps, reusable |
| New client | `apps/<client>` | Talk to API via `@intel.dom.gob/sdk` only |

## Commit messages

Concise, imperative, descriptive of intent: `feat(provider): add Brave search provider`.

## Code style

* TypeScript, explicit types from `packages/types`.
* `createLogger("layer:concern")` for every log line.
* No dead code, no commented-out code, no unused dependencies.

## License

MIT. By contributing you agree your contributions are released under MIT.

# Repository Tree — INTEL.DOM.GOB

Generated from the refactored monorepo. (See also `docs/architecture.md`,
`docs/adr.md`, `docs/migration-report.md`.)

```
intel.dom.gob/
├── apps/
│   ├── api/                      # API gateway — Express, /v1, OpenAPI, SSE, rate-limit
│   │   └── src/
│   │       ├── index.ts          # bootstrap: providers → services → orchestrator → routes
│   │       ├── routes.ts         # /v1/health, /institutions, /url-tree, /query, /query/stream, /chat
│   │       └── openapi.ts        # auto-generated OpenAPI spec
│   ├── studio/                   # React SPA client — consumes the API only
│   ├── web/                      # lightweight no-JS client (SDK only)
│   ├── admin/                    # operator/admin console (SDK only)
│   └── cli/                      # command-line client (SDK only): query/chat/institutions
├── services/
│   ├── orchestrator/             # THE HEART — runQuery + runQueryStream (SSE)
│   ├── search/  ai/  institutions/  crawler/
│   ├── auth/                     # API keys, JWT, orgs (DB-backed)
│   ├── embeddings/  rag/         # vector embeddings + retrieval-augmented generation
│   ├── memory/                   # structured codebase/architecture memory
│   ├── documents/                # chunking/cleaning
│   ├── ocr/                      # OCR delegation to OcrProvider
│   ├── scheduler/  evaluation/  storage/  presentation/
│   └── mcp/                      # MCP server — a pure SDK client of the API (pluggable tools)
├── providers/
│   ├── (package.json)            # @intel.dom.gob/providers — interfaces + ProviderRegistry
│   ├── searxng/  gemini/         # defaults
│   ├── openai/  anthropic/       # optional AI providers (registered when key present)
│   ├── unlimited-ocr/            # OCR provider (Unlimited-OCR / OpenOCR endpoint)
│   └── hyperframes/              # presentation provider
├── packages/
│   ├── types/  logger/  config/  utils/  sdk/
│   └── database/                 # ORM-free Postgres pool + idempotent migrations
├── docker/
│   ├── docker-compose.yml        # single canonical stack (9 services)
│   ├── caddy/  searxng/  docs/   # reverse proxy, preserved search, docs site
├── scripts/                      # init setup start stop restart logs doctor backup restore
│   └── lint format test clean update deploy
├── tests/                        # vitest: orchestrator assembly + provider contract
├── docs/  README.md  AGENTS.md  CONTRIBUTING.md  CHANGELOG.md  WORK.md
└── package.json (npm workspaces root)
```

## Deliverables provided (per WORK.md)

1. **Repository tree** — this file.
2. **Architecture diagram** — `docs/architecture.md` (ASCII flow + layering + FLUJO flow).
3. **Migration report** — `docs/migration-report.md`.
4. **Architectural decisions** — `docs/adr.md` (10 ADRs).
5. **Future extension points** — `docs/adr.md` + `README.md` Roadmap (OCR, Presentation,
   Memory, Knowledge Graph, Auth, Streaming, MCP).
6. **Remaining technical debt** — `docs/migration-report.md` "Residual technical debt".
7. **Recommendations for production** — `docs/migration-report.md` "Remaining work to reach
   production" (storage, auth, streaming, OpenAPI, tests, MCP, optional services).

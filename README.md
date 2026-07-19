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
   Search · AI · Institutions · Crawler · OCR · Memory · RAG · …
        │
        ▼
   Providers
   ───────────────────────────────
   SearXNG (default search) · Gemini (default AI) · + future providers
        │
        ▼
   Infrastructure
   ───────────────────────────────
   PostgreSQL · Redis · Object Storage · Docker · Caddy
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
│   ├── api/          # Express API gateway (delegates to Orchestrator)
│   └── studio/       # React SPA client (consumes the API only)
├── services/
│   ├── orchestrator/ # business logic: multi-agent reasoning
│   ├── search/       # Search Service (SearXNG + news engines)
│   ├── ai/           # AI Service (wraps AI providers)
│   ├── institutions/ # institution plugins (Senado, Cámara, DGCP, …)
│   └── crawler/      # URL-tree builder
├── providers/
│   ├── searxng/      # default Search Provider
│   └── gemini/       # default AI Provider
├── packages/
│   ├── types/        # shared domain types
│   ├── logger/       # structured logging
│   ├── config/       # env configuration
│   ├── utils/        # shared utilities
│   └── sdk/          # the ONLY way clients talk to the API
├── docker/
│   ├── caddy/        # reverse proxy (subdomain routing + HTTPS)
│   ├── searxng/      # preserved SearXNG settings
│   └── docker-compose.yml
├── scripts/          # start / stop / doctor / deploy / …
├── docs/
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
./scripts/start.sh
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
docker compose up -d        # brings up api, studio, mcp, web, admin, docs, searxng, postgres, dragonfly, caddy
docker compose ps           # health-checked services
```

* Every container exposes `/health`, `/ready`, `/live`.
* Only Caddy publishes ports (80/443). All other services use internal Docker DNS.
* Services communicate by name: `api`, `searxng`, `postgres`, `dragonfly`.

---

## Scripts

All operational scripts live in `scripts/`:

| Script | Purpose |
|--------|---------|
| `init.sh` | Validate prerequisites, install deps |
| `start.sh` | `docker compose up -d` + endpoints |
| `up.sh` | Build + start the full stack, run a comprehensive health/endpoint report, and print a presentation of service health, exposed endpoints, workers and the API surface |
| `stop.sh` | `docker compose down` |
| `restart.sh` | Full restart |
| `logs.sh [svc]` | Tail logs |
| `doctor.sh` | Prerequisite + health checks |
| `backup.sh` | Backup volumes |
| `restore.sh <file>` | Restore PostgreSQL |
| `lint.sh` | Typecheck all workspaces |
| `format.sh` | Format code |
| `test.sh` | Run tests |
| `clean.sh` | Remove build artifacts |
| `update.sh` | Update dependencies |
| `deploy.sh` | One-command production deploy |

---

## Development

Run services independently (no Docker needed for code changes):

```bash
npm install --workspaces
cd apps/api && npm run dev       # API on :4000
cd apps/studio && npm run dev    # Studio on :5173 (Vite)
```

---

## Providers

Adding a provider requires **only** creating a new implementation:

```ts
// providers/brave/src/index.ts
import { createSearchProvider } from "@intel.dom.gob/providers";
export const brave = createSearchProvider({
  id: "brave",
  async search(query) { /* ... */ return []; },
});
```

Register it in `apps/api/src/index.ts`. Nothing else changes.

| Kind | Default | Future |
|------|---------|--------|
| Search | SearXNG | Brave, Exa, Tavily, Google |
| AI | Gemini | OpenAI, Anthropic, Ollama, DeepSeek |

---

## Services

Each service has exactly one responsibility and is independently testable:

* **Orchestrator** — agent execution, planning, search/AI orchestration, result merging.
* **Search** — web/news retrieval through the Search Provider.
* **AI** — model calls via the AI Provider.
* **Institutions** — pluggable Dominican government sources.
* **Crawler** — categorized URL-tree builder.

---

## API

Versioned REST (`/v1`). The API contains **no business logic** — every endpoint delegates to the Orchestrator.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/health` | Service health |
| GET | `/v1/institutions` | Dynamic institution registry |
| GET | `/v1/url-tree` | Categorized URL tree (`?refresh=1`, `?portals=`) |
| POST | `/v1/query` | Multi-agent intelligence query |
| POST | `/v1/chat` | Context-grounded follow-up chat |

All clients (Studio, CLI, MCP, SDKs) use `@intel.dom.gob/sdk`.

---

## Studio

The Studio is the primary application — a React SPA that communicates **exclusively** with the API. It contains no business logic: only chat, conversations, prompts, history, tool browsing, provider selection, settings, and streaming.

---

## MCP

The MCP server is another client of the platform: it calls the API like any other client and never invokes providers or services directly. Future MCP tools are pluggable.

---

## Deployment

Single command, identical to local:

```bash
./scripts/deploy.sh
```

Internally: `git pull` → `docker compose pull` → `docker compose up -d --build` → health checks.

Suitable for self-hosting and cloud VPS without modification.

---

## Roadmap

* OCR service (Unlimited-OCR) — provider-backed, replaceable.
* Presentation service (HyperFrames) — optional export plugin.
* Memory service (codebase-memory-mcp) — optional, first-class.
* Knowledge Graph service — entity relationships between laws/decrees.
* MCP server client + pluggable tools.
* Auth: JWT, API keys, OAuth, organizations, teams, permissions.
* WebSockets + SSE streaming for tool/search progress.

---

## FAQ

**Why a reverse proxy with subdomains instead of ports?**
Ports are a dev artifact. Production behaves like `studio.intel.dom.gob`, and development mirrors it exactly via `studio.localhost`. One mental model, zero config drift.

**Where does the AI key go?**
`GEMINI_API_KEY` in `.env` (never committed). The API also accepts a per-request `apiKey` for multi-tenant use.

**Is the existing SearXNG setup preserved?**
Yes — `docker/searxng/settings.yml` is the original anonymous JSON API configuration, mounted unchanged.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md).

## License

MIT.

# Web — IntelDomGob Lightweight Web Client

Minimal, no-JS, server-rendered web client for INTEL.DOM.GOB. Lists government institutions and runs intelligence queries — useful as a lightweight fallback and as a reference implementation.

## Quick Start

```bash
# From the repo root
cd apps/web
npm install
npm run dev
```

Or from the monorepo root:

```bash
npm run dev --workspace=apps/web
```

The web client starts on port `4200` by default. Open `http://localhost:4200`.

## Standalone (without Docker)

The web client needs the API server running. Point it at the API:

```bash
INTEL_API_URL=http://localhost:4000 npm run dev
```

## Public / Preview Mode

The web client works **without an API key**. It does not send any credentials — it relies on the platform's `REQUIRE_API_KEY` setting. In development mode (`REQUIRE_API_KEY=false`, the default), all endpoints are open and the client works immediately.

In production, set `REQUIRE_API_KEY=true` and configure a `WEB_API_TOKEN` or modify the client to forward credentials.

## Pages

| Route | Description |
|-------|-------------|
| `GET /` | Home page with institution list and search form |
| `GET /query?q=...` | Intelligence query results with summary, sources, and confidence |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INTEL_API_URL` | `http://api:4000` | API gateway base URL |
| `WEB_PORT` | `4200` | Port to listen on |

## Architecture

This is a pure SDK client — it uses `@intel.dom.gob/sdk` to talk to the API. No business logic, no direct service/provider imports.

```
Browser → Web (Express, port 4200) → SDK → API → Orchestrator → Services → Providers
```

## Tech Stack

- **Express.js** — minimal server-side rendering
- **@intel.dom.gob/sdk** — API client
- **Inline HTML** — no client-side JS, no templates, no build step
- **TypeScript** — type-checked with `tsc --noEmit`

## License

MIT

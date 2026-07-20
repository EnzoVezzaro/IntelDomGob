# Web — INTEL.DOM.GOB Public Site

The **public-facing website** for INTEL.DOM.GOB — a polished, server-rendered marketing + product site with a **live demo** that queries the platform in real time. Modeled on modern developer-product sites (dark, bold, interactive) but built entirely on our own stack.

## What it is

- **Landing page** — hero, live demo, quick-start (Studio / API / CLI / Web tabs), capabilities, product ecosystem, principles, and pricing.
- **Live demo** — a search box that calls the platform's intelligence query through the SDK and renders a real, source-backed answer. Works with **no API key** in preview mode.
- **No-JS fallback** — core content is server-rendered HTML; the demo enhances with vanilla JS but a shareable `/buscar?q=` page works without JS.
- **No build step** — plain TypeScript run by `tsx`, static `public/` assets served by Express.

## Quick Start

```bash
# From the repo root
cd apps/web
npm install
npm run dev
```

Open `http://localhost:4200`. In Docker Compose it runs at `web.localhost` / `web.intel.dom.gob` (port 4200).

## Standalone (without Docker)

Point it at a running API:

```bash
INTEL_API_URL=http://localhost:4000 npm run dev
```

## Public / Preview Mode

The site works **without an API key**. It uses `@intel.dom.gob/sdk` with no `token` — when the platform runs with `REQUIRE_API_KEY=false` (the development default), the live demo queries the API freely on the **Público** tier (20 queries/day). Set `REQUIRE_API_KEY=true` and a key to move to production.

## Architecture

```
Browser → Web (Express, :4200) → SDK → API → Orchestrator → Services → Providers
```

- `src/index.ts` — Express server, routes, SDK client, demo endpoint.
- `src/views.ts` — server-rendered HTML templates (layout, home, results).
- `public/styles.css` — the design system (dark, INTEL-red `#e94e31` accent).
- `public/app.js` — vanilla JS: quick-start tabs, copy buttons, hero typing, live demo.

This is a pure SDK client — no business logic, no direct service/provider imports.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INTEL_API_URL` | `http://api:4000` | API gateway base URL |
| `WEB_PORT` | `4200` | Port to listen on |

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Full landing page |
| `POST /api/query` | Live demo endpoint (JSON: `{ q }` → result) |
| `GET /buscar?q=` | Shareable, no-JS results page |
| `GET /styles.css`, `/app.js` | Static assets |

## License

MIT

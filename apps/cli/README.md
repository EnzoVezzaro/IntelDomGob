# CLI — IntelDomGob Terminal Client

Interactive terminal client for INTEL.DOM.GOB. Connects to the MCP server and exposes all platform capabilities through a branded prompt loop — no API logic lives here.

## Quick Start

```bash
# From the repo root
cd apps/cli
npm install
npm run dev
```

Or from the monorepo root:

```bash
npm run dev --workspace=apps/cli
```

The CLI connects to the MCP server at `http://mcp.localhost/mcp` by default. When running via Docker Compose, the MCP server is already available at that address.

## Standalone (without Docker)

If you have the API + MCP server running separately:

```bash
INTEL_MCP_URL=http://localhost:4100/mcp npm run dev
```

## Public / Preview Mode

The CLI requires **no API key** to run. Authentication is handled by the MCP server and the platform backend. When the platform runs with `REQUIRE_API_KEY=false` (the default in development), everything works out of the box.

In production (`REQUIRE_API_KEY=true`), the MCP server authenticates to the API using `INTEL_API_TOKEN` — the CLI itself never handles keys.

## Onboarding (first run)

The first time you launch the CLI in an interactive terminal, it walks you through two short prompts and saves your answers to `~/.intel/config.json`:

1. **INTEL.API key** — paste your API key (`idg_…`). Leave empty to use the free **Público** plan (20 intelligence queries/day, no signup). The entered key is validated live against `GET /v1/key/verify` before being saved; an invalid key is rejected and you're asked again.
2. **LLM interpreter (optional)** — pick an OpenAI-compatible provider + model. Used only to rewrite the structured MCP result into fluent prose. Skip to keep the raw structured render.

On subsequent launches, the CLI reads the saved config and goes straight to the chat.

### Show current settings

Before the chat opens, the CLI prints a resume of the active configuration:

```
┌  Configuración
│ Plan: investigador · 200/día · key: idg_abc…xyz
│ Intérprete: gpt-4o-mini @ https://api.openai.com/v1
│ Servidor MCP: http://mcp.localhost/mcp
└
```

### Re-onboard

Delete `~/.intel/config.json` (or just the relevant field) to re-trigger either prompt, or override via env / CLI flags (see below).

## Commands

| Command | Description |
|---------|-------------|
| *(free text)* | Sends to the multi-agent intelligence query |
| `/query <text>` | Explicitly invoke the intelligence query |
| `/chat <text>` | Follow-up question grounded in previous result |
| `/fetch <url>` | Fetch a URL and return readable text |
| `/institutions` | List available government institution plugins |
| `/tools` | Interactive menu: pick any MCP tool from the catalog |
| `/help` | Show help |
| `/exit` | Exit the session |

### One-Shot Mode

```bash
npm run dev -- -p "¿Cuáles son las iniciativas legislativas recientes?"
```

### Quiet Mode (for scripts/pipes)

```bash
npm run dev -p "query" -q -f json
```

## Optional: Local LLM Rewrite

The CLI can optionally rewrite structured MCP results into fluent prose using any OpenAI-compatible endpoint. Configure via env or the interactive startup prompt:

| Variable | Description |
|----------|-------------|
| `INTEL_LLM_BASE_URL` | OpenAI-compatible endpoint (e.g. `https://api.openai.com/v1`) |
| `INTEL_LLM_API_KEY` | API key for the LLM provider |
| `INTEL_LLM_MODEL` | Model name (e.g. `gpt-4o-mini`) |

When unset, the CLI renders structured results directly (no prose rewrite).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INTEL_MCP_URL` | `http://mcp.localhost/mcp` | MCP server endpoint |
| `INTEL_API_KEY` | *(unset)* | INTEL.DOM.GOB API key. Overrides `~/.intel/config.json`. Empty = Público plan |
| `INTEL_LLM_BASE_URL` | *(disabled)* | Optional LLM for prose rewriting |
| `INTEL_LLM_API_KEY` | *(disabled)* | Optional LLM API key |
| `INTEL_LLM_MODEL` | *(disabled)* | Optional LLM model name |

## Architecture

The CLI is a **pure MCP client** — it uses the `@modelcontextprotocol/sdk` to connect to the MCP server via Streamable HTTP (with SSE fallback). It does not import any platform service, provider, or the `@intel.dom.gob/sdk` package.

Key verification during onboarding also flows through MCP: the CLI calls the MCP server's `verify_key` tool, which forwards the request to the API via the SDK. The CLI never talks to the API directly.

```
CLI (onboarding)  →  MCP `verify_key` tool  →  SDK  →  API /v1/key/verify  →  AuthService
CLI (runtime)     →  MCP protocol           →  MCP Server (SDK)             →  API → Orchestrator → Services → Providers
```

## License

MIT

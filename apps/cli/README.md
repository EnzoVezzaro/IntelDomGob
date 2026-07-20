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
| `INTEL_LLM_BASE_URL` | *(disabled)* | Optional LLM for prose rewriting |
| `INTEL_LLM_API_KEY` | *(disabled)* | Optional LLM API key |
| `INTEL_LLM_MODEL` | *(disabled)* | Optional LLM model name |

## Architecture

The CLI is a **pure MCP client** — it uses the `@modelcontextprotocol/sdk` to connect to the MCP server via Streamable HTTP (with SSE fallback). It does not import any platform service, provider, or the `@intel.dom.gob/sdk` package.

```
CLI (MCP protocol) → MCP Server (SDK) → API → Orchestrator → Services → Providers
```

## License

MIT

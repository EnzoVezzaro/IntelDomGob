# SDK — @intel.dom.gob/sdk

The single authorized client surface for talking to the INTEL.DOM.GOB API. Every client (Studio, Web, CLI, Admin, MCP) uses this package.

## Install

```bash
npm install @intel.dom.gob/sdk
```

Or use it directly from the monorepo:

```ts
import { createClient } from "@intel.dom.gob/sdk";
```

## Quick Start

```ts
import { createClient } from "@intel.dom.gob/sdk";

const client = createClient({
  baseUrl: "http://api.localhost",   // or https://api.intel.dom.gob
  token: "your-api-key",            // optional — omit in preview mode
});

const result = await client.query({ query: "¿Cuáles son las iniciativas recientes?" });
console.log(result.response.summary);
```

## Preview / No-Auth Mode

When the platform runs with `REQUIRE_API_KEY=false` (default in development), omit the `token`:

```ts
const client = createClient({ baseUrl: "http://api.localhost" });
```

All endpoints work without authentication. In production (`REQUIRE_API_KEY=true`), a valid API key is required.

## API

### `createClient(options)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `baseUrl` | `string` | Yes | API gateway URL (e.g. `http://api.localhost`) |
| `token` | `string` | No | API key for `Authorization: Bearer` header |
| `version` | `string` | No | API version prefix (default: `"v1"`) |

### Intelligence

```ts
// Multi-agent query
await client.query({ query: "string", institutions?: string[] });

// Streaming query (SSE)
for await (const event of client.queryStream({ query: "..." })) {
  console.log(event);
}

// Follow-up chat
await client.chat({ context: "...", message: "..." });
```

### Institutions

```ts
await client.listInstitutions();
await client.searchInstitution("senado", { query: "..." });
```

### Legislative Data (SIL)

```ts
// Cámara de Diputados
await client.silCamaraIniciativas();
await client.silCamaraComisiones();
await client.silCamaraSesiones();
await client.silCamaraLegislador({ query: "..." });

// Senado
await client.silSenadoIniciativas();
await client.silSenadoBoletines();
await client.silSenadoResoluciones();
await client.silSenadoSearch({ query: "..." });
await client.silSenadoSenadores();
```

### Knowledge Graph

```ts
await client.graph({ entity: "..." });
await client.graphIngest(result); // IntelligenceResult
```

### Infrastructure

```ts
await client.health();
await client.openApi();  // returns OpenAPI spec
await client.mcpTools(); // list MCP server tools
```

## Error Handling

Non-OK responses throw with the server's `error` and `message` fields:

```ts
try {
  await client.query({ query: "..." });
} catch (e) {
  console.error(e.message); // e.g. "Unauthorized", "Rate limit exceeded"
}
```

## Subdomain Convention

The SDK accepts a full `baseUrl`. Clients typically derive it from the browser's hostname:

```ts
// Browser on studio.localhost → API at api.localhost
const host = window.location.host;
const domain = host.slice(host.indexOf(".") + 1);
const baseUrl = `${window.location.protocol}//api.${domain}`;
```

Development: `http://api.localhost` · Production: `https://api.intel.dom.gob`

## License

MIT

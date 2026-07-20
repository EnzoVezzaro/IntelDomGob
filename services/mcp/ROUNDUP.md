# MCP Server — Feature & Tool Roundup

`services/mcp` is a **pure client** of the INTEL.DOM.GOB platform. It speaks MCP
(JSON-RPC, 2025-03-26) to the outside world but every tool invocation flows
through the SDK (`@intel.dom.gob/sdk`) to the API gateway — never directly to a
service or provider (per `AGENTS.md` "The One Rule"). The per-institution search
tools are derived at boot from the SDK's `listInstitutions()` endpoint, so the
MCP server imports **no service or provider package** — only the SDK.

## Transports

| Endpoint | Purpose |
|----------|---------|
| `POST /` | Legacy INTEL.DOM.GOB JSON-RPC surface (`tools/list`, `tools/call`). |
| `POST /mcp` | MCP Streamable HTTP (initialize, ping, tools/list, tools/call). SSE when `Accept: text/event-stream`. |
| `GET /mcp` | SSE stream — legacy SSE handshake (`event: endpoint`) **and** server→client Streamable HTTP stream (requires `Mcp-Session-Id`). |
| `DELETE /mcp` | Session teardown (clears `Mcp-Session-Id`). |
| `GET /health` | Liveness; lists every registered tool name. |

Protocol details verified by `tests/protocol.test.ts`:
`initialize` → `protocolVersion: 2025-03-26`, capabilities, serverInfo; assigns a
UUID `Mcp-Session-Id`; `notifications/initialized` returns no body; `ping` →
`{}`; `tools/list` returns annotations with `title`; `tools/call` →
`{ content:[{type:"text"}], isError }`; unknown tool → `-32601`; unknown method →
`-32601`; unknown `Mcp-Session-Id` → `401`.

## Tool Catalog (registered via `registerTool` / `tools[]`)

### Core intelligence
- **`query`** — full multi-agent intelligence report (streams search/plan/retrieval/reasoning events, emits progress). Auto-routes by `scope` (`legislativo`, `sil`, `senate`, `camara`, `senate-news`, `camara-news`, `diputado`). → `client.queryStream`
- **`chat`** — follow-up question grounded in a previous `IntelligenceResult`. → `client.chat`
- **`list_institutions`** — listed government institution plugins. → `client.listInstitutions`

### Generic institution search (friendly names)
Each searches one institution portal/jurisprudence/open-data:
- **`tribunal_search`** (judiciary), **`presidencia_search`** (presidency),
  **`dgcp_search`** (DGCP contrataciones), **`datos_search`** (datos abiertos),
  **`consultoria_search`** (consultoría jurídica), **`compras_search`** (comunidad de compras).
  → `client.searchInstitution(<id>, query)`

### Web fetch
- **`fetch_url`** — fetch one URL, return readable text + metadata. → `client.fetchUrl`

### Cámara de Diputados SIL (`diputadosrd.gob.do/sil/api/`)
- `sil_camara_iniciativas` (search, `periodoId` default 0)
- `sil_camara_iniciativa_detalle` (base record by `id`)
- `sil_camara_iniciativa_completa` (base + all sub-resources)
- `sil_camara_iniciativa_<sub>` for `sub` ∈ `proponentes | historicos | comisiones | actividades | documentos | votaciones`
- `sil_camara_comisiones` (`tipoId` optional), `sil_camara_comision_tipos`
- `sil_camara_iniciativa_count`, `sil_camara_iniciativa_grupos`, `sil_camara_iniciativa_materias` (by `grupo`)
- `sil_camara_sesiones`, `sil_camara_grupos` (parliamentary groups), `sil_camara_legislador`

### Senado de la República SIL / DSpace (`memoriahistorica.senadord.gob.do`)
- `sil_senado_iniciativas`, `sil_senado_boletines`, `sil_senado_resoluciones`
- `senado_news` (WordPress press)
- `senado_search` (full DSpace, `scope` ∈ `root|iniciativas|all`, `maxResults`)
- `senado_communities`, `senado_collections`
- `senado_senadores` (by name/`periodo`), `senado_senadores_periodos`, `senado_senadores_periodo`, `senado_senador` (by UUID)
- `senado_expediente` (single DSpace record by UUID)

## How a tool is added
1. Implement a `McpTool` (`name`, `description`, `inputSchema`, optional `annotations`, `run(args, client, notify)`).
2. `registerTool(tool)` in `services/mcp/src/index.ts`.
3. It is automatically exposed on **both** the legacy `POST /` and the MCP `/mcp` surface — single source of truth.

## Tests
- `tests/protocol.test.ts` — 15 protocol-compliance + session round-trip tests.
- `tests/tools.test.ts` — 196 mocked functional tests (≥5 scenarios per tool):
  correct SDK method + args, default handling (`periodoId`/`scope`/maxResults),
  return shaping, progress notifications, and error surfacing.
- Run: `node --import tsx --test tests/*.test.ts` (exit 0, deterministic, no network).

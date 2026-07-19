# API Reference — INTEL.DOM.GOB

Base URL: `https://api.intel.dom.gob` (or `http://api.localhost`). All routes are
versioned under `/v1`. Clients should use `@intel.dom.gob/sdk`.

Every endpoint delegates to the Orchestrator or a Service. The API gateway contains
**no business logic**.

---

## Health

### `GET /health` · `GET /ready` · `GET /live`
Root-level health endpoints (no `/v1` prefix).

```json
{ "status": "ok", "timestamp": "2026-...", "service": "api", "apiKeyConfigured": true }
```

### `GET /v1/health`
Versioned health endpoint.

```json
{ "status": "ok", "timestamp": "2026-...", "service": "api", "version": "v1" }
```

---

## Institutions

### `GET /v1/institutions`
Returns the dynamic registry of institution plugins.

```json
{
  "institutions": [
    { "id": "senate", "name": "Senado de la República", "url": "https://www.senadord.gob.do",
      "enabledByDefault": true, "hasLegislative": true }
  ]
}
```

---

## URL Tree

### `GET /v1/url-tree`
Returns the categorized URL tree per portal.

Query params:
* `refresh=1` — rebuild the cache.
* `portals=Presidencia,Senado` — filter to specific portals.

```json
{
  "cached": true,
  "generatedAt": "2026-...",
  "portals": [
    { "name": "Senado de la República", "url": "...", "refId": "senate",
      "sections": [ { "category": "news", "label": "...", "count": 12, "urls": [] } ] }
  ]
}
```

---

## Query (multi-agent intelligence)

### `POST /v1/query`
Runs the full multi-agent retrieval + reasoning loop.

Request body (`QueryRequest`):
```json
{
  "query": "reforma al Código Penal",
  "institutions": ["Senado de la República", "Cámara de Diputados"],
  "model": "gemini-3.1-flash-lite",
  "provider": "gemini",
  "apiKey": "optional-per-request-key",
  "scope": "all",
  "responseLang": "es",
  "search": { "lang": "es", "category": "general", "safe": false, "maxResults": 8 }
}
```

`scope` values: `all`, `sil`, `legislativo`, `legislative_search`, `senate`, `camara`, `senate-news`, `camara-news`, `diputado`.

Response: a full `IntelligenceResult` (the "Audit Evidence Packet") with:
* `sources` — FLUJO A (congress), B (tribunal), C (datos), D (news), laws, bulletins, perInstitution.
* `planner`, `institution`, `search`, `retrieval`, `evidence`, `validation`, `refinement`.
* `response` — summary, detailedAnalysis, timeline, confidenceLevel, citations.

Errors:
* `400` — missing query or API key.
* `500` — retrieval processing error.

### `POST /v1/query/stream`
Streaming variant (Server-Sent Events). Same request body as `/v1/query`.

Events emitted:
```
event: plan
data: { "intent": "...", "institutionsSelected": [...], "plan": "..." }

event: search
data: { "queriesRun": 28 }

event: token
data: { "text": "chunk of AI response" }

event: result
data: { <full IntelligenceResult> }
```

---

## Chat (context-grounded)

### `POST /v1/chat`
Answers follow-up questions strictly from a previously retrieved result.

Request body (`ChatRequest`):
```json
{
  "context": { "<previous IntelligenceResult>" },
  "message": "¿Cuál es el estado del proyecto de ley X?",
  "history": [ { "role": "user", "content": "..." } ],
  "apiKey": "optional",
  "provider": "gemini",
  "model": "gemini-3.1-flash-lite"
}
```

Response:
```json
{ "reply": "..." }
```

---

## OpenAI-Compatible API

### `POST /v1/chat/completions`
OpenAI-compatible chat endpoint. Supports both synchronous and streaming responses.

Request body:
```json
{
  "model": "gemini-3.1-flash-lite",
  "messages": [
    { "role": "user", "content": "¿Qué dice la ley 87-01?" }
  ],
  "stream": false
}
```

When `stream: true`, returns SSE events in OpenAI format:
```
data: { "id": "idg", "object": "chat.completion.chunk", "model": "intel", "choices": [{ "delta": { "content": "..." } }] }
data: [DONE]
```

### `GET /v1/models`
List available AI models from the provider registry.

```json
{
  "object": "list",
  "data": [
    { "id": "gemini", "object": "model", "owned_by": "intel.dom.gob" }
  ]
}
```

### `POST /v1/embeddings`
Generate text embeddings.

Request body:
```json
{ "input": "text or array of texts" }
```

Response:
```json
{
  "object": "list",
  "data": [
    { "object": "embedding", "index": 0, "embedding": [0.1, 0.2, ...] }
  ],
  "model": "intel-embeddings"
}
```

---

## Document Intelligence Pipeline

### `POST /v1/documents/process`
Run the full document intelligence pipeline: Storage → OCR → Text → Classification → Metadata → Entities → Embeddings → Knowledge Graph.

Request body:
```json
{
  "documentId": "doc-123",
  "storageKey": "uploads/report.pdf",
  "format": "text"
}
```

`format`: `text` (default), `markdown`, `tables`.

Response:
```json
{
  "documentId": "doc-123",
  "storageKey": "uploads/report.pdf",
  "textStorageKey": "uploads/report.pdf.ocr.txt",
  "charCount": 12345,
  "classification": "legislation",
  "metadata": { "pages": 12345, "language": "es", "source": "uploads/report.pdf" },
  "entities": [{ "text": "Ley 87-01", "type": "law" }],
  "relations": [{ "from": "Ley 87-01", "to": "Seguro Social", "type": "creates" }],
  "embeddingDim": 768,
  "graphEntities": 5
}
```

### `POST /v1/entities/extract`
Extract entities and relations from arbitrary text.

Request body:
```json
{ "text": "La Ley 87-01 creó el Sistema Dominicano de Seguridad Social..." }
```

Response:
```json
{
  "entities": [
    { "text": "Ley 87-01", "type": "law", "start": 3, "end": 14, "confidence": 0.95 },
    { "text": "Sistema Dominicano de Seguridad Social", "type": "institution", "start": 22, "end": 60, "confidence": 0.9 }
  ],
  "relations": [
    { "from": "Ley 87-01", "to": "Sistema Dominicano de Seguridad Social", "type": "creates", "confidence": 0.7 }
  ]
}
```

---

## Knowledge Graph

### `POST /v1/graph/ingest`
Ingest an IntelligenceResult packet into the Knowledge Graph.

Request body: full `IntelligenceResult` object.

```json
{ "entities": 12, "relations": 8 }
```

### `GET /v1/graph`
Query the Knowledge Graph. Optionally filter to the neighborhood of one entity.

Query params:
* `entity=<entityId>` — return the entity's neighbors.

```json
{
  "graph": { "entities": [...], "relations": [...] },
  "neighbors": [{ "entity": {...}, "degree": 5 }]
}
```

---

## Workflow Engine

### `POST /v1/workflows`
Define and execute a DAG workflow.

Request body:
```json
{
  "name": "Research Pipeline",
  "steps": [
    { "id": "search", "action": "search_senate", "params": { "query": "ley 87-01" } },
    { "id": "ocr", "deps": ["search"], "action": "ocr_extract", "params": {} },
    { "id": "report", "deps": ["ocr"], "requiresApproval": true, "action": "generate_report", "params": {} }
  ],
  "inputs": { "caseId": "case-123" }
}
```

Response (202 Accepted):
```json
{
  "workflowId": "wf_1234567890_abc",
  "name": "Research Pipeline",
  "status": "running",
  "context": { "workflowId": "...", "inputs": {...}, "results": {...} }
}
```

### `GET /v1/workflows/:id`
Get current workflow state.

### `POST /v1/workflows/:id/approve`
Approve a paused step and resume execution.

```json
{ "stepId": "report" }
```

### `POST /v1/workflows/:id/deny`
Deny a paused step and abort the workflow.

```json
{ "stepId": "report" }
```

---

## Tools

### `GET /v1/tools`
List all registered tools.

```json
[
  { "id": "web.search", "name": "Web Search", "description": "...", "category": "retrieval", "risk": "low", "params": {...} }
]
```

### `POST /v1/tools/:id/execute`
Execute a registered tool.

```json
{ "query": "ley 87-01", "limit": 5 }
```

---

## Prompts

### `GET /v1/prompts`
List all prompt templates with version history.

### `GET /v1/prompts/:key`
Get a specific prompt and all its versions.

### `POST /v1/prompts`
Create or update a prompt template (requires `admin` scope).

```json
{
  "key": "research.system",
  "template": "Eres el asistente de INTEL.DOM.GOB...",
  "description": "System prompt for research queries",
  "note": "v1 initial"
}
```

### `POST /v1/prompts/:key/render`
Render a prompt with variables.

```json
{ "vars": { "query": "ley 87-01" }, "version": 1 }
```

---

## Evaluation

### `POST /v1/evaluate/faithfulness`
Evaluate how much of an answer is grounded in context.

```json
{ "answer": "...", "context": "..." }
```

Response:
```json
{ "score": 0.85, "supported": ["claim 1", "claim 2"], "unsupported": ["claim 3"] }
```

### `POST /v1/evaluate/quality`
Evaluate answer quality across dimensions.

```json
{ "answer": "...", "prompt": "original question" }
```

Response:
```json
{ "score": 0.78, "dimensions": { "relevance": 0.9, "completeness": 0.7, "clarity": 0.8, "safety": 1.0 } }
```

---

## Plugins

### `GET /v1/plugins`
List registered plugins.

```json
[
  { "id": "custom-source", "name": "Custom Source", "version": "1.0.0", "kind": "source", "description": "..." }
]
```

### `POST /v1/plugins/:id/run`
Execute a plugin (requires `execute` scope).

```json
{ "arg1": "value1" }
```

---

## Tenancy

### `GET /v1/tenant`
Returns the current tenant context for the authenticated request.

```json
{ "tenantId": "org-123", "global": false }
```

---

## System

### `GET /v1/metrics`
Prometheus-format metrics endpoint (standard scrape target, no auth required).

### `GET /v1/mcp/tools`
Catalog of tools exposed by the MCP server. Documents all 20+ MCP tools for client discovery.

### `GET /v1/docs`
Interactive Swagger UI for exploring the API.

### `GET /v1/openapi.json`
Auto-generated OpenAPI specification.

---

## Institution Direct Data (SIL)

### Cámara de Diputados (SIL API — diputadosrd.gob.do)

| Endpoint | Description |
|----------|-------------|
| `GET /v1/sil/camara/iniciativas` | Search initiatives by keyword. Params: `query`, `periodoId`, `grupo`, `tipo`, `perimidas` |
| `GET /v1/sil/camara/comisiones` | List committees. Params: `tipoId`, `periodoId` |
| `GET /v1/sil/camara/comision/tipo` | List committee types (Permanentes, Especiales, etc.) |
| `GET /v1/sil/camara/iniciativa/count` | Total initiative count |
| `GET /v1/sil/camara/iniciativa/grupos` | 15 initiative topic groups |
| `GET /v1/sil/camara/iniciativa/materias` | Matters within a topic group. Required: `grupo` |
| `GET /v1/sil/camara/sesiones` | Sessions by keyword or session number |
| `GET /v1/sil/camara/grupos` | Parliamentary groups (59 total) |
| `GET /v1/sil/camara/legislador` | Search legislators by name |

### Senado de la República (DSpace — memoriahistorica.senadord.gob.do)

| Endpoint | Description |
|----------|-------------|
| `GET /v1/sil/senado/iniciativas` | Search initiatives + resolutions |
| `GET /v1/sil/senado/boletines` | Search bulletins, actas, reports |
| `GET /v1/sil/senado/resoluciones` | Search resolutions only |
| `GET /v1/senado/news` | WordPress press/news (not SIL) |
| `GET /v1/sil/senado/search` | Full-text search across ~32k DSpace items. Params: `query`, `scope` (root/iniciativas/all), `maxResults` |
| `GET /v1/sil/senado/communities` | Browse DSpace community tree. Params: `parentId` |
| `GET /v1/sil/senado/collections/:collectionId/items` | List items in a collection |

---

## Authentication

By default (`REQUIRE_API_KEY=false` in development), all endpoints are open. When `REQUIRE_API_KEY=true` (production default), every `/v1` request requires a valid API key via:

* `Authorization: Bearer <api-key>` header, or
* `apiKey` field in the request body.

API keys carry scopes (`read`, `query`, `chat`, `admin`, `execute`) enforced via RBAC. Multi-tenant keys carry a `tenant_id` that isolates data; the `X-Tenant-Id` header is validated against the key's tenant to prevent spoofing (deny-by-default).

Some endpoints require specific scopes:
* `POST /v1/prompts` — requires `admin` scope
* `POST /v1/plugins/:id/run` — requires `execute` scope
* `POST /v1/workflows` — requires `query` scope

---

## Errors

All errors return:
```json
{ "error": "<code>", "message": "<human-readable>" }
```

OpenAI-compatible endpoints return:
```json
{ "error": { "message": "...", "type": "invalid_request_error" } }
```

---

## Rate Limiting

120 requests per minute per IP (configurable via `express-rate-limit`). Returns:
```json
{ "error": "Rate limit exceeded", "message": "Too many requests, slow down." }
```

---

## Versioning

The API is versioned (`/v1`, future `/v2`). Breaking changes ship under a new version
prefix; the previous version is retained until explicitly deprecated.

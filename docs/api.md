# API Reference — INTEL.DOM.GOB

Base URL: `https://api.intel.dom.gob` (or `http://api.localhost`). All routes are
versioned under `/v1`. Clients should use `@intel.dom.gob/sdk`.

Every endpoint delegates to the Orchestrator or a Service. The API gateway contains
**no business logic**.

---

## Health

### `GET /v1/health`
```json
{ "status": "ok", "timestamp": "2026-...", "service": "api", "version": "v1" }
```

Also available at the root: `GET /health`, `GET /ready`, `GET /live`.

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
  "apiKey": "optional-per-request-key",
  "responseLang": "es",
  "search": { "lang": "es", "category": "general", "safe": false, "maxResults": 8 }
}
```

Response: a full `IntelligenceResult` (the "Audit Evidence Packet") with:
* `sources` — FLUJO A (congress), B (tribunal), C (datos), D (news), laws, bulletins, perInstitution.
* `planner`, `institution`, `search`, `retrieval`, `evidence`, `validation`, `refinement`.
* `response` — summary, detailedAnalysis, timeline, confidenceLevel, citations.

Errors:
* `400` — missing query or API key.
* `500` — retrieval processing error.

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
  "model": "gemini-3.1-flash-lite"
}
```

Response:
```json
{ "reply": "..." }
```

The model is constrained to the supplied context and cites official sources.

---

## Errors

All errors return:
```json
{ "error": "<code>", "message": "<human-readable>" }
```

---

## Versioning

The API is versioned (`/v1`, future `/v2`). Breaking changes ship under a new version
prefix; the previous version is retained until explicitly deprecated.

// OpenAPI specification for the INTEL.DOM.GOB API.
//
// The spec is generated programmatically so it stays in sync with the versioned
// router. It is served at GET /v1/openapi.json and rendered by Swagger UI at
// GET /v1/docs. The API exposes NO business logic — every endpoint delegates to
// the Orchestrator, so this document describes the public contract only.

export function buildOpenApiSpec(version = "v1"): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "INTEL.DOM.GOB API",
      version,
      description:
        "API-first gateway for the Dominican Government Intelligence platform. Every client (Studio, Web, CLI, Admin, MCP) consumes this API. All endpoints delegate to the Orchestrator.",
      license: { name: "MIT" },
    },
    servers: [
      { url: "https://api.intel.dom.gob", description: "Production" },
      { url: "http://api.localhost", description: "Local development" },
    ],
    tags: [
      { name: "system", description: "Health and version endpoints" },
      { name: "discovery", description: "Dynamic capability discovery" },
      { name: "intelligence", description: "Multi-agent intelligence queries" },
      { name: "sil", description: "Direct Cámara de Diputados SIL data (iniciativas, comisiones, sesiones, legisladores)" },
      { name: "senado", description: "Direct Senado de la República data (iniciativas, boletines, news)" },
    ],
    paths: {
      [`/${version}/health`]: {
        get: {
          tags: ["system"],
          summary: "Versioned health probe",
          responses: {
            "200": { description: "Service is healthy", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } },
          },
        },
      },
      [`/${version}/institutions`]: {
        get: {
          tags: ["discovery"],
          summary: "List registered institution plugins",
          responses: {
            "200": {
              description: "Institution registry",
              content: { "application/json": { schema: { type: "object", properties: { institutions: { type: "array", items: { $ref: "#/components/schemas/Institution" } } } } } },
            },
          },
        },
      },
      [`/${version}/url-tree`]: {
        get: {
          tags: ["discovery"],
          summary: "Categorized URL tree of government sources",
          parameters: [
            { name: "refresh", in: "query", schema: { type: "string" } },
            { name: "portals", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "URL tree" }, "202": { description: "Building" } },
        },
      },
      [`/${version}/query`]: {
        post: {
          tags: ["intelligence"],
          summary: "Run a multi-agent intelligence query",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/QueryRequest" } } },
          },
          responses: {
            "200": { description: "Intelligence result", content: { "application/json": { schema: { $ref: "#/components/schemas/IntelligenceResult" } } } },
            "400": { description: "Invalid request" },
            "500": { description: "Processing error" },
          },
        },
      },
      [`/${version}/query/stream`]: {
        post: {
          tags: ["intelligence"],
          summary: "Stream a multi-agent query (SSE)",
          description: "Emits progress events (search, plan, reasoning, token) then a final `result` event.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/QueryRequest" } } },
          },
          responses: { "200": { description: "text/event-stream" } },
        },
      },
      [`/${version}/chat`]: {
        post: {
          tags: ["intelligence"],
          summary: "Context-grounded follow-up chat",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ChatRequest" } } },
          },
          responses: { "200": { description: "Reply", content: { "application/json": { schema: { type: "object", properties: { reply: { type: "string" } } } } } } },
        },
      },
      // --- Direct institution endpoints (both chambers' SIL) ---
      [`/${version}/sil/camara/comision/tipo`]: {
        get: {
          tags: ["sil"],
          summary: "List Cámara committee types",
          description: "Returns: Permanentes (974), Especiales (975), Bicamerales Permanentes (976), Bicamerales Especiales (977), Coordinadora (978).",
          parameters: [
            { name: "periodoId", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Committee types" } },
        },
      },
      [`/${version}/sil/camara/comisiones`]: {
        get: {
          tags: ["sil"],
          summary: "List Cámara committees by type",
          description: "Without tipoId returns all. With tipoId (974=Permanentes, 975=Especiales) returns that type.",
          parameters: [
            { name: "tipoId", in: "query", schema: { type: "number" } },
            { name: "periodoId", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Committees" } },
        },
      },
      [`/${version}/sil/camara/iniciativa/count`]: {
        get: {
          tags: ["sil"],
          summary: "Total count of Cámara SIL initiatives",
          responses: { "200": { description: "Count" } },
        },
      },
      [`/${version}/sil/camara/iniciativa/grupos`]: {
        get: {
          tags: ["sil"],
          summary: "List 15 Cámara initiative topic groups",
          responses: { "200": { description: "Topic groups" } },
        },
      },
      [`/${version}/sil/camara/iniciativa/materias`]: {
        get: {
          tags: ["sil"],
          summary: "List matters within a topic group",
          parameters: [
            { name: "grupo", in: "query", required: true, schema: { type: "number" } },
            { name: "periodoId", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Matters" } },
        },
      },
      [`/${version}/sil/camara/iniciativas`]: {
        get: {
          tags: ["sil"],
          summary: "Search Cámara SIL initiatives",
          description: "Keyword search or filtered by grupo/tipo/perimidas.",
          parameters: [
            { name: "query", in: "query", schema: { type: "string" } },
            { name: "grupo", in: "query", schema: { type: "number" } },
            { name: "tipo", in: "query", schema: { type: "string" } },
            { name: "perimidas", in: "query", schema: { type: "string" } },
            { name: "periodoId", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Matching initiatives" } },
        },
      },
      [`/${version}/sil/camara/sesiones`]: {
        get: {
          tags: ["sil"],
          summary: "List or look up Cámara SIL sessions",
          description: "Empty query returns all sessions. With session number (e.g. '00042-2026-PLO') returns that specific session.",
          parameters: [
            { name: "query", in: "query", schema: { type: "string", description: "Session number or empty for all" } },
            { name: "periodoId", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Cámara sessions" } },
        },
      },
      [`/${version}/sil/camara/grupos`]: {
        get: {
          tags: ["sil"],
          summary: "List all Cámara parliamentary groups",
          description: "Returns all 59 groups: political parties, PARLACEN, nationality-based groups.",
          parameters: [
            { name: "query", in: "query", schema: { type: "string" } },
            { name: "periodoId", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Cámara parliamentary groups" } },
        },
      },
      [`/${version}/sil/camara/legislador`]: {
        get: {
          tags: ["sil"],
          summary: "Search for a Cámara legislator by name",
          parameters: [
            { name: "query", in: "query", required: true, schema: { type: "string" } },
            { name: "periodoId", in: "query", schema: { type: "number" } },
          ],
          responses: { "200": { description: "Matching Cámara legislators" } },
        },
      },
      [`/${version}/sil/senado/iniciativas`]: {
        get: {
          tags: ["senado"],
          summary: "Search Senado SIL (DSpace) for initiatives and resolutions",
          parameters: [
            { name: "query", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Matching Senado SIL initiatives" } },
        },
      },
      [`/${version}/sil/senado/boletines`]: {
        get: {
          tags: ["senado"],
          summary: "Search Senado SIL (DSpace) for bulletins, actas, and informes",
          parameters: [
            { name: "query", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Matching Senado SIL publications" } },
        },
      },
      [`/${version}/sil/senado/resoluciones`]: {
        get: {
          tags: ["senado"],
          summary: "Search Senado SIL (DSpace) for resolutions only",
          parameters: [
            { name: "query", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Matching Senado SIL resolutions" } },
        },
      },
      [`/${version}/senado/news`]: {
        get: {
          tags: ["senado"],
          summary: "Search Senado WordPress press/news (not SIL)",
          parameters: [
            { name: "query", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Matching Senado news" } },
        },
      },
    },
    components: {
      schemas: {
        Health: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "degraded", "error"] },
            timestamp: { type: "string" },
            service: { type: "string" },
            version: { type: "string" },
          },
        },
        Institution: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            url: { type: "string" },
            enabledByDefault: { type: "boolean" },
            hasLegislative: { type: "boolean" },
          },
        },
        QueryRequest: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            institutions: { type: "array", items: { type: "string" } },
            model: { type: "string" },
            provider: { type: "string" },
            apiKey: { type: "string" },
            scope: { type: "string", enum: ["all", "legislativo", "sil", "senate", "camara", "senate-news", "camara-news", "diputado"], description: "Intent-based source scope. Auto-detected from query when omitted." },
            responseLang: { type: "string" },
            search: { type: "object" },
          },
        },
        ChatRequest: {
          type: "object",
          required: ["message", "context"],
          properties: {
            message: { type: "string" },
            context: {},
            history: { type: "array" },
            model: { type: "string" },
            apiKey: { type: "string" },
          },
        },
        IntelligenceResult: {
          type: "object",
          description: "The structured Audit Evidence Packet returned by the Orchestrator.",
          properties: {
            query: { type: "string" },
            timestamp: { type: "string" },
            sources: { type: "object" },
            evidence: { type: "array" },
            response: { type: "object" },
          },
        },
      },
    },
  };
}

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
            apiKey: { type: "string" },
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

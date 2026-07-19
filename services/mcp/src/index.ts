// services/mcp
//
// The MCP server is just ANOTHER client of the platform.
//
// It speaks MCP (JSON-RPC) to the outside world but, internally, every tool
// invocation goes through the INTEL.DOM.GOB SDK — exactly like Studio, Web,
// CLI and Admin. It NEVER imports a service or provider directly.
//
// Adding a Tool requires only registering it here; core infrastructure is
// untouched (WORK.md "Future MCP tools should be pluggable").

import express from "express";
import { createLogger } from "@intel.dom.gob/logger";
import { IntelDomGobClient, createClient } from "@intel.dom.gob/sdk";
import { mountMcpProtocol } from "./mcp-protocol";

const log = createLogger("service:mcp");

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: any, client: IntelDomGobClient, notify?: ProgressNotifier): Promise<unknown>;
}

/** Progress notification callback — tools call this to send MCP notifications/message during execution. */
export interface ProgressNotifier {
  (level: "info" | "warning" | "error", message: string, extra?: Record<string, unknown>): void;
}

export interface McpServerOptions {
  apiBaseUrl: string;
  token?: string;
  port?: number;
}

/** Registry of pluggable MCP tools. New tools are added via registerTool(). */
export const tools: McpTool[] = [];

export function registerTool(tool: McpTool): void {
  if (tools.find((t) => t.name === tool.name)) return;
  tools.push(tool);
}

// --- Default tools (all delegate to the API through the SDK) -----------------

registerTool({
  name: "query",
  description: "Run a full multi-agent intelligence query. Auto-detects intent and routes to the right tools. Use 'scope' to force: 'sil' (Congress records), 'senate'/'camara' (specific chamber), 'senate-news'/'camara-news' (press only), 'diputado' (legislator profile). Emits progress notifications during execution.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      institutions: { type: "array", items: { type: "string" } },
      scope: { type: "string", enum: ["all", "sil", "senate", "camara", "senate-news", "camara-news", "diputado"] },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    const events: any[] = [];
    try {
      await client.queryStream(
        { query: args.query, institutions: args.institutions, scope: args.scope },
        (event) => {
          events.push(event);
          if (notify && ["search", "plan", "retrieval", "reasoning"].includes(event.type)) {
            const msg = event.type === "search"
              ? `Searching: ${event.query ?? event.engine ?? "..."}`
              : event.type === "plan"
              ? `Planning: ${event.intent ?? "..."} (${event.queries?.length ?? 0} sub-queries)`
              : event.type === "retrieval"
              ? `Retrieved ${event.totalResults ?? 0} results`
              : event.type === "reasoning"
              ? `Generating response...`
              : `${event.type}`;
            notify("info", msg, { event: event.type, ...event });
          }
        },
      );
    } catch (e: any) {
      if (notify) notify("error", `Stream failed: ${e.message}`);
    }
    const result = events.find((e) => e.type === "result");
    return result ?? { error: "No result event received", events: events.map((e) => e.type) };
  },
});

registerTool({
  name: "chat",
  description: "Ask a follow-up question grounded in a previous IntelligenceResult.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" }, context: {}, history: { type: "array" } },
    required: ["message", "context"],
  },
  async run(args, client) {
    return client.chat({ message: args.message, context: args.context, history: args.history });
  },
});

registerTool({
  name: "list_institutions",
  description: "List registered government institution plugins.",
  inputSchema: { type: "object", properties: {} },
  async run(_args, client) {
    return client.listInstitutions();
  },
});

// --- Individual Institution Tools -------------------------------------------
// Both chambers have their own SIL (Sistema de Información Legislativa):
//   - Cámara SIL: diputadosrd.gob.do/sil/api/
//   - Senado SIL: memoriahistorica.senadord.gob.do/server/api (DSpace)

registerTool({
  name: "sil_camara_iniciativas",
  description: "Search Cámara de Diputados SIL for legislative initiatives (iniciativas). Use for queries about specific laws, bills, expedientes, or initiatives by keyword or number. Returns official legislative records from the Cámara SIL system.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword or expediente number (e.g. 'código penal', '05491')" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Cámara SIL iniciativas for: ${args.query}`);
    return client.silCamaraIniciativas(args.query, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_comisiones",
  description: "List Cámara de Diputados committees. Without tipoId returns all committees. With tipoId (e.g. 974=Permanentes, 975=Especiales) returns committees of that type. Use sil_camara_comision_tipos first to discover available types.",
  inputSchema: {
    type: "object",
    properties: {
      tipoId: { type: "number", description: "Committee type ID (974=Permanentes, 975=Especiales, 976=BicameralPerm, 977=BicameralEsp, 978=Coordinadora)" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
  },
  async run(args, client, notify) {
    if (notify) notify("info", args.tipoId ? `Fetching Cámara committees type ${args.tipoId}...` : "Fetching all Cámara committees...");
    return client.silCamaraComisiones(args.tipoId, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_comision_tipos",
  description: "List Cámara de Diputados committee types (Permanentes, Especiales, Bicamerales, Coordinadora). Returns type IDs needed to query committees by type.",
  inputSchema: {
    type: "object",
    properties: {
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
  },
  async run(args, client, notify) {
    if (notify) notify("info", "Fetching Cámara committee types...");
    return client.silCamaraComisionTipos(args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_iniciativa_count",
  description: "Get total count of all Cámara de Diputados SIL initiatives in the current legislative period.",
  inputSchema: {
    type: "object",
    properties: {
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
  },
  async run(args, client, notify) {
    if (notify) notify("info", "Counting Cámara initiatives...");
    return client.silCamaraIniciativaCount(args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_iniciativa_grupos",
  description: "List all 15 Cámara de Diputados initiative topic groups (Administración, Agricultura, Economía, Educación, etc.). Use with sil_camara_iniciativa_materias to drill down into specific topics.",
  inputSchema: {
    type: "object",
    properties: {
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
  },
  async run(args, client, notify) {
    if (notify) notify("info", "Fetching Cámara initiative topic groups...");
    return client.silCamaraIniciativaGrupos(args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_iniciativa_materias",
  description: "List Cámara de Diputados initiative matters (materias) within a topic group. First call sil_camara_iniciativa_grupos to get group IDs, then call this with the grupo ID.",
  inputSchema: {
    type: "object",
    properties: {
      grupo: { type: "number", description: "Topic group ID (1-15, from sil_camara_iniciativa_grupos)" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
    required: ["grupo"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Fetching matters for group ${args.grupo}...`);
    return client.silCamaraIniciativaMaterias(args.grupo, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_sesiones",
  description: "List or look up Cámara de Diputados SIL sessions (sesiones). With empty query returns all sessions paginated. With a session number (e.g. '00042-2026-PLO') returns that specific session. Session numbers follow the format NNNNN-YEAR-TYPE (e.g. 00042-2026-PLO).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword (e.g. 'aprobación', 'reforma')" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Cámara sessions for: ${args.query}`);
    return client.silCamaraSesiones(args.query, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_grupos",
  description: "List all parliamentary groups (grupos parlamentarios) in the Cámara de Diputados. Returns all 59 groups including international parliamentary groups (PARLACEN, etc.), political parties, and nationality-based groups. Use when the user asks about political groups, party coalitions, or faction composition.",
  inputSchema: {
    type: "object",
    properties: {
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
  },
  async run(args, client, notify) {
    if (notify) notify("info", args.query ? `Searching Cámara groups for: ${args.query}` : "Fetching all Cámara parliamentary groups...");
    return client.silCamaraGrupos(args.periodoId ?? 0, args.query ?? "");
  },
});

registerTool({
  name: "sil_camara_legislador",
  description: "Search for a specific Cámara legislator (diputado) by name. Returns their profile, party, district, and contact info. Use for queries like 'hablame del diputado Musa' or 'quién es el representante por Santiago'.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Legislator name (e.g. 'Musa', 'Juan Perez')" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching for Cámara legislator: ${args.query}`);
    return client.silCamaraLegislador(args.query, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_senado_iniciativas",
  description: "Search Senado de la República SIL (DSpace) for legislative initiatives and resolutions. Use for queries about Senate bills, projects, or initiatives by keyword.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword (e.g. 'reforma constitucional', 'presupuesto')" },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Senado SIL initiatives for: ${args.query}`);
    return client.silSenadoIniciativas(args.query);
  },
});

registerTool({
  name: "sil_senado_boletines",
  description: "Search Senado SIL (DSpace) for official bulletins (boletines), session records (actas), and reports (informes). Use for official Senate SIL publications.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword" },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Senado SIL bulletins for: ${args.query}`);
    return client.silSenadoBoletines(args.query);
  },
});

registerTool({
  name: "sil_senado_resoluciones",
  description: "Search Senado SIL (DSpace) specifically for resolutions (resoluciones). Use when the user asks about Senate resolutions or formal decisions.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword" },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Senado SIL resolutions for: ${args.query}`);
    return client.silSenadoResoluciones(args.query);
  },
});

registerTool({
  name: "senado_news",
  description: "Search Senado WordPress press/news (not SIL). Use for queries about Senate press releases, blog posts, announcements, or recent Senate activity in the news.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword" },
    },
    required: ["query"],
  },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Senado news for: ${args.query}`);
    return client.senadoNews(args.query);
  },
});

export class McpServer {
  private readonly client: IntelDomGobClient;
  private readonly port: number;
  private app = express();

  constructor(opts: McpServerOptions) {
    this.client = createClient({ baseUrl: opts.apiBaseUrl, token: opts.token });
    this.port = opts.port ?? 4100;
    this.app.use(express.json());

    // Legacy INTEL.DOM.GOB JSON-RPC surface (internal clients).
    this.app.post("/", (req, res) => this.handle(req.body, res));

    // Official MCP-protocol surface (Streamable HTTP + SSE) so standard MCP
    // clients like Odysseus, Claude Desktop and VS Code can connect. Reuses the
    // exact same tool registry — no second source of truth.
    mountMcpProtocol(this.app, () => createClient({ baseUrl: opts.apiBaseUrl, token: opts.token }));

    this.app.get("/health", (_req, res) =>
      res.json({
        status: "ok",
        service: "mcp",
        transports: ["jsonrpc", "mcp-streamable-http", "mcp-sse"],
        mcpEndpoint: "/mcp",
        tools: tools.map((t) => t.name),
      }),
    );
  }

  private async handle(request: any, res: express.Response) {
    const { id, method, params } = request;
    try {
      if (method === "tools/list") {
        return res.json({
          jsonrpc: "2.0",
          id,
          result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
        });
      }
      if (method === "tools/call") {
        const tool = tools.find((t) => t.name === params?.name);
        if (!tool) return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool ${params?.name}` } });
        // Legacy handler: no streaming notifications, but pass notify for consistency.
        const output = await tool.run(params?.arguments ?? {}, this.client);
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] } });
      }
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e: any) {
      log.error("MCP request failed", { method, error: e.message });
      return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } });
    }
  }

  start(): void {
    this.app.listen(this.port, "0.0.0.0", () => {
      log.info("MCP server listening", { port: this.port, toolCount: tools.length });
    });
  }
}

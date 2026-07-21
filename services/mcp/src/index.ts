// services/mcp
//
// The MCP server is just ANOTHER client of the platform.
//
// It speaks MCP (JSON-RPC) to the outside world but, internally, every tool
// invocation goes through the INTEL.DOM.GOB SDK — exactly like Studio, Web,
// CLI and Admin. It NEVER imports a service or provider directly.
//
// NOTE: this module does not import @intel.dom.gob/service-institutions (a
// service package). The per-institution search tools are derived at boot from
// the SDK's listInstitutions() endpoint, so MCP stays a pure SDK client per
// AGENTS.md ("No client imports a service or provider directly").
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
  /** MCP 2025-03-26 annotations — includes human-readable title for UI display. */
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
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
  description: "Run a full multi-agent intelligence query and return a structured report. This is NOT a chat tool — it must be called directly as an MCP tool, never passed to send_to_session. Auto-detects intent and routes to the right tools. Use 'scope' to force: 'legislativo'/'sil' (Congress records), 'senate'/'camara' (specific chamber), 'senate-news'/'camara-news' (press only), 'diputado' (legislator profile). Emits progress notifications during execution.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      institutions: { type: "array", items: { type: "string" } },
      scope: { type: "string", enum: ["all", "legislativo", "legislative_search", "legislative", "sil", "senate", "camara", "senate-news", "camara-news", "diputado"] },
    },
    required: ["query"],
  },
  annotations: { title: "Consulta de Inteligencia", readOnlyHint: true },
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
  annotations: { title: "Chat de Seguimiento", readOnlyHint: true },
  async run(args, client) {
    return client.chat({ message: args.message, context: args.context, history: args.history });
  },
});

registerTool({
  name: "list_institutions",
  description: "List registered government institution plugins.",
  inputSchema: { type: "object", properties: {} },
  annotations: { title: "Listar Instituciones", readOnlyHint: true },
  async run(_args, client) {
    return client.listInstitutions();
  },
});

// Verify an INTEL.DOM.GOB API key without the client having to talk to the API
// directly. The CLI / Studio / MCP browser call this during onboarding: they
// pass the candidate key as `apiKey`, the MCP server forwards it to the API
// (via the SDK) and returns tier metadata (plan, scopes, quota, rate limit).
// `apiKey` empty/omitted → returns the Público preview record (valid=false).
// `apiKey` present but invalid → the API returns 401, surfaced here as
// `{ valid: false, error: <message> }` (the tool itself never throws).
registerTool({
  name: "verify_key",
  description:
    "Verify an INTEL.DOM.GOB API key and return its tier metadata (plan, scopes, quotaDaily, rateLimit). " +
    "Pass `apiKey` to verify a candidate key; omit it to read the current session's key (or the Público preview when unauthenticated).",
  inputSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string", description: "INTEL.DOM.GOB API key to verify (e.g. idg_xxx). Leave empty to verify the current (or Público) session." },
    },
    required: [],
  },
  annotations: { title: "Verificar API Key", readOnlyHint: true },
  async run(args, client) {
    try {
      return await client.verifyKey(args.apiKey);
    } catch (e: any) {
      // 401 from the API → the tool shouldn't raise an MCP error (that would
      // surface as a generic tool failure). Return a structured invalid shape
      // so the caller can show "invalid key" cleanly.
      return { valid: false, error: e?.message ?? String(e) };
    }
  },
});

// Friendly, discoverable tool names for the non-legislative institutions so
// users see e.g. `tribunal_search` / `dgcp_search` instead of a generic
// `institution_search_<id>`. Legislative chambers (senate/chamber) keep their
// rich, granular SIL tools registered below.
const INSTITUTION_TOOL_NAMES: Record<string, { name: string; title: string }> = {
  judiciary:   { name: "tribunal_search",   title: "Buscar en Tribual Constitucional" },
  presidency: { name: "presidencia_search", title: "Buscar en Presidencia" },
  dgcp:       { name: "dgcp_search",       title: "Buscar en Contrataciones Públicas (DGCP)" },
  datos:       { name: "datos_search",     title: "Buscar en Datos Abiertos RD" },
  consultoria: { name: "consultoria_search", title: "Buscar en Consultoría Jurídica" },
  compras:     { name: "compras_search",    title: "Buscar Licitaciones (Comunidad de Compras)" },
};

// Static fallback so tools still register even if the API is unreachable at
// boot. The live list (with names/descriptions) is fetched via the SDK below.
const KNOWN_INSTITUTION_IDS = ["senate", "chamber", "presidency", "judiciary", "dgcp", "datos", "consultoria", "compras"];

interface InstitutionInfo { id: string; name: string; description?: string }

// Register one search tool per government institution. The institution list is
// sourced EXCLUSIVELY from the SDK (client.listInstitutions()) — no service
// package is imported here, keeping MCP a pure platform client. senate/chamber
// are intentionally skipped: their rich, granular SIL tools are registered
// further below.
export async function registerInstitutionTools(client: IntelDomGobClient): Promise<void> {
  let list: InstitutionInfo[];
  try {
    const descriptors = await client.listInstitutions();
    list = descriptors.map((d: any) => ({ id: d.id, name: d.name, description: d.description }));
  } catch (e: any) {
    log.warn("Could not fetch institution list from API; using static fallback", { error: e?.message });
    list = KNOWN_INSTITUTION_IDS.map((id) => ({ id, name: id }));
  }
  if (list.length === 0) {
    list = KNOWN_INSTITUTION_IDS.map((id) => ({ id, name: id }));
  }

  for (const inst of list) {
    if (inst.id === "senate" || inst.id === "chamber") continue;
    const friendly = INSTITUTION_TOOL_NAMES[inst.id];
    const toolName = friendly ? friendly.name : `institution_search_${inst.id}`;
    const toolTitle = friendly ? friendly.title : `Buscar en ${inst.name}`;
    registerTool({
      name: toolName,
      description: `${inst.name} — ${inst.description ?? "búsqueda institucional"}. Search this institution's official portal/jurisprudence/news/open-data for a keyword, document, sentencia number or licitación.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: `Search query for ${inst.name} (keyword, sentencia number, licitación, dataset, etc.)` },
        },
        required: ["query"],
      },
      annotations: { title: toolTitle, readOnlyHint: true },
      async run(args, c, notify) {
        if (notify) notify("info", `Searching ${inst.name} for: ${args.query}`);
        return c.searchInstitution(inst.id, args.query);
      },
    });
  }
}

registerTool({
  name: "fetch_url",
  description: "Fetch a single web page and return its readable text + metadata (title, cleaned body, published date). Use this when the user asks 'what does this URL say?' or provides a direct link to a government page, news article, or PDF. This is NOT a search tool — it fetches the exact URL given.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The exact http(s) URL to fetch (e.g. https://www.tribunalconstitucional.gob.do/...)" },
      timeoutMs: { type: "number", description: "Optional fetch timeout in ms (default 15000)" },
      maxChars: { type: "number", description: "Optional max characters of body text to return (default 16000)" },
    },
    required: ["url"],
  },
  annotations: { title: "Leer Página Web", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Fetching: ${args.url}`);
    return client.fetchUrl(args.url, { timeoutMs: args.timeoutMs, maxChars: args.maxChars });
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
  annotations: { title: "Iniciativas Cámara SIL", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Cámara SIL iniciativas for: ${args.query}`);
    return client.silCamaraIniciativas(args.query, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_iniciativa_detalle",
  description: "Get the base detail of a single Cámara de Diputados initiative (iniciativa) by its numeric ID: tipo, número, descripción, estado, condición, materia, grupo, fechas (depósito, promulgación), legislatura, número de promulgación, origen. This is the fast, base-only record. For a SPECIFIC sub-resource only (proponentes, historicos, comisiones, actividades, documentos, votaciones), use the matching sil_camara_iniciativa_<sub> tool. For everything at once, use sil_camara_iniciativa_completa.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "number", description: "Numeric initiative ID (e.g. 158495, from sil_camara_iniciativas results)" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
    required: ["id"],
  },
  annotations: { title: "Detalle de Iniciativa Cámara", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Fetching Cámara iniciativa detail: ${args.id}`);
    return client.silCamaraIniciativaDetalle(args.id, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_camara_iniciativa_completa",
  description: "Get the FULL detail of a single Cámara de Diputados initiative by its numeric ID — the base record PLUS all related sub-resources in one call: proponentes (authors/sponsors with diputado, party and province), historicos (status history / trámites with dates), comisiones (committees), actividades (committee activities/sesiones), documentos (attached PDFs — each annotated with a resolved urlDescarga download link), and votaciones (votes). Sub-resources are paginated to include the complete set (not just the first 10). Use this when the user asks who proposed a bill, its history/timeline, its documents, committees, activities or votes. For just the base fields, sil_camara_iniciativa_detalle is faster.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "number", description: "Numeric initiative ID (e.g. 158495, from sil_camara_iniciativas results)" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
    required: ["id"],
  },
  annotations: { title: "Iniciativa Cámara (detalle completo)", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Fetching full Cámara iniciativa detail: ${args.id}`);
    return client.silCamaraIniciativaCompleta(args.id, args.periodoId ?? 0);
  },
});

// --- Granular Cámara initiative sub-resource tools -------------------------
// Each calls ONLY its own SIL endpoint, so specific questions (e.g. "list the
// documents of this initiative") don't pull the whole /completa bundle.

const CAMARA_SUB_RECURSOS: { sub: string; title: string; what: string }[] = [
  { sub: "proponentes", title: "Proponentes Iniciativa Cámara", what: "authors/sponsors (diputado, party, province)" },
  { sub: "historicos", title: "Histórico Iniciativa Cámara", what: "status history / trámites with dates" },
  { sub: "comisiones", title: "Comisiones Iniciativa Cámara", what: "committees it was sent to" },
  { sub: "actividades", title: "Actividades Iniciativa Cámara", what: "committee activities / sesiones" },
  { sub: "documentos", title: "Documentos Iniciativa Cámara", what: "attached PDFs (each with a resolved urlDescarga download link)" },
  { sub: "votaciones", title: "Votaciones Iniciativa Cámara", what: "votes (sesión, moción, fecha, votos)" },
];

for (const r of CAMARA_SUB_RECURSOS) {
  registerTool({
    name: `sil_camara_iniciativa_${r.sub}`,
    description: `Get ONLY the ${r.sub} of a single Cámara de Diputados initiative by its numeric ID — the ${r.what}. Use this for specific questions instead of sil_camara_iniciativa_completa (which returns everything). Pass the sub-resource name as the 'sub' argument.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Numeric initiative ID (e.g. 158495, from sil_camara_iniciativas results)" },
        periodoId: { type: "number", description: "Legislative period (0 = current)" },
      },
      required: ["id"],
    },
    annotations: { title: r.title, readOnlyHint: true },
    async run(args, client, notify) {
      if (notify) notify("info", `Fetching ${r.sub} for Cámara iniciativa ${args.id}`);
      return client.silCamaraIniciativaSub(r.sub, args.id, args.periodoId ?? 0);
    },
  });
}

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
  annotations: { title: "Comisiones Cámara", readOnlyHint: true },
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
  annotations: { title: "Tipos de Comisión Cámara", readOnlyHint: true },
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
  annotations: { title: "Contar Iniciativas Cámara", readOnlyHint: true },
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
  annotations: { title: "Grupos Temáticos Cámara", readOnlyHint: true },
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
  annotations: { title: "Materias por Grupo Cámara", readOnlyHint: true },
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
  annotations: { title: "Sesiones Cámara", readOnlyHint: true },
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
  annotations: { title: "Grupos Parlamentarios Cámara", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", args.query ? `Searching Cámara groups for: ${args.query}` : "Fetching all Cámara parliamentary groups...");
    return client.silCamaraGrupos(args.periodoId ?? 0, args.query ?? "");
  },
});

registerTool({
  name: "sil_camara_legislador",
  description: "Search Cámara de Diputados by legislator name. Returns the legislator's profile (party, commissions) and all their filed initiatives. Use when the user asks about a specific deputy's legislative activity. Always search using full or partial names.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Legislator name to search for" },
      periodoId: { type: "number", description: "Legislative period (0 = current)" },
    },
    required: ["query"],
  },
  annotations: { title: "Buscar Diputado", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching for Cámara legislator: ${args.query}`);
    return client.silCamaraLegislador(args.query, args.periodoId ?? 0);
  },
});

registerTool({
  name: "sil_senado_iniciativas",
  description: "Search Senado de la República SIL (DSpace) for legislative initiatives and resolutions ONLY. Use for queries like 'hablame de la iniciativa XXX', 'proyectos de ley del senado', 'qué proyectos tiene el senado'. For broader searches across ALL document types (boletines, actas, contratos, libros), use senado_search instead.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword (e.g. 'reforma constitucional', 'presupuesto')" },
    },
    required: ["query"],
  },
  annotations: { title: "Iniciativas Senado SIL", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Senado SIL initiatives for: ${args.query}`);
    return client.silSenadoIniciativas(args.query);
  },
});

registerTool({
  name: "sil_senado_boletines",
  description: "Search Senado SIL (DSpace) for official bulletins (boletines), session records (actas), and reports (informes). Use for queries like 'boletines del senado', 'actas de sesiones del senado', 'informes del senado'.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword" },
    },
    required: ["query"],
  },
  annotations: { title: "Boletines Senado SIL", readOnlyHint: true },
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
  annotations: { title: "Resoluciones Senado SIL", readOnlyHint: true },
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
  annotations: { title: "Noticias Senado", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Senado news for: ${args.query}`);
    return client.senadoNews(args.query);
  },
});

registerTool({
  name: "senado_search",
  description: "Full-text search across the entire Senado DSpace repository (Memoria Histórica del Senado, ~32k items). Covers ALL document types: iniciativas, resoluciones, boletines, actas, contratos, acuerdos internacionales, libros, documentos institucionales. Use scope='iniciativas' to narrow to legislative initiatives only. Use scope='root' for the broadest search across everything.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword (e.g. 'presupuesto 2024', 'contrato', 'acta senado')" },
      scope: { type: "string", enum: ["root", "iniciativas", "all"], description: "Search scope: 'root' (all items ~32k, default), 'iniciativas' (legislative only), 'all' (no scope filter)" },
      maxResults: { type: "number", description: "Max results to return (default 20, max 100)" },
    },
    required: ["query"],
  },
  annotations: { title: "Búsqueda Completa Senado", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching Senado DSpace (scope: ${args.scope ?? "root"}) for: ${args.query}`);
    const result = await client.silSenadoSearch(args.query, args.scope ?? "root", args.maxResults ?? 20);
    if (notify) notify("info", `Found ${result.total} results in Senado DSpace`);
    return result;
  },
});

registerTool({
  name: "senado_communities",
  description: "Browse the Senado DSpace community tree (Memoria Histórica). Returns sub-communities and collections for a given parent. Use to discover what document categories are available: Cronológico de Senadores, Documentos Institucionales (boletines, actas, libros), Documentos Legislatives (leyes, constitución), Iniciativas Legislativas (proyectos, contratos), Rendición de Cuentas.",
  inputSchema: {
    type: "object",
    properties: {
      parentId: { type: "string", description: "Parent community UUID (omit for root: fc1aa418-1f3f-46ee-a300-6d6047e53d01)" },
    },
  },
  annotations: { title: "Comunidades Senado DSpace", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", args.parentId ? `Fetching Senado sub-communities for: ${args.parentId}` : "Fetching Senado community tree (root)...");
    return client.silSenadoCommunities(args.parentId);
  },
});

registerTool({
  name: "senado_collections",
  description: "List items within a specific Senado DSpace collection. Use senado_communities first to discover collection IDs, then call this with the collection UUID to browse its documents. Each collection represents a specific document category (e.g. 'Actas Asamblea Nacional', 'Leyes Decretos Resoluciones', 'Contratos').",
  inputSchema: {
    type: "object",
    properties: {
      collectionId: { type: "string", description: "Collection UUID (from senado_communities)" },
      query: { type: "string", description: "Optional keyword filter within the collection" },
      maxResults: { type: "number", description: "Max results (default 20, max 100)" },
    },
    required: ["collectionId"],
  },
  annotations: { title: "Colecciones Senado DSpace", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Fetching items from Senado collection: ${args.collectionId}`);
    const result = await client.silSenadoCollectionItems(args.collectionId, args.query ?? "", args.maxResults ?? 20);
    if (notify) notify("info", `Found ${result.total} items in collection`);
    return result;
  },
});

// --- Cronológico de Senadores (Senator directory) ---------------------------
// The Senado's "Cronológico de Senadores" is a directory of senators grouped by
// constitutional period (2010-2016, 2016-2020, 2020-2024, 2024-2028). Each
// senator record includes name, political party, province, quadrennium and a
// photo. These tools query that directory specifically.

registerTool({
  name: "senado_senadores",
  description: "Search the Senado de la República senator directory (Cronológico de Senadores) by name. Returns each senator's name, political party (partido), province they represent (provincia), constitutional period (periodo/cuatrienio) and photo. Searches across ALL periods by default; pass 'periodo' (e.g. '2020-2024') to restrict to one period. Use for questions like 'quién es el senador X', 'senadores del PLD', 'senador de Santiago'.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Senator name to search for (e.g. 'valenzuela', 'reinaldo pared')" },
      periodo: { type: "string", enum: ["2010-2016", "2016-2020", "2020-2024", "2024-2028"], description: "Optional constitutional period filter" },
      maxResults: { type: "number", description: "Max results (default 20, max 100)" },
    },
    required: ["query"],
  },
  annotations: { title: "Buscar Senador", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Searching senators for: ${args.query}${args.periodo ? ` (${args.periodo})` : ""}`);
    const result = await client.silSenadoSenadores(args.query, args.periodo, args.maxResults ?? 20);
    if (notify) notify("info", `Found ${result.total} senator(s)`);
    return result;
  },
});

registerTool({
  name: "senado_senadores_periodos",
  description: "List the available constitutional periods (cuatrienios) in the Senado senator directory, each with its senator count. Use this first to discover valid 'periodo' values (2010-2016, 2016-2020, 2020-2024, 2024-2028) before calling senado_senadores_periodo.",
  inputSchema: { type: "object", properties: {} },
  annotations: { title: "Periodos de Senadores", readOnlyHint: true },
  async run(_args, client, notify) {
    if (notify) notify("info", "Fetching senator periods...");
    return client.silSenadoSenadoresPeriodos();
  },
});

registerTool({
  name: "senado_senadores_periodo",
  description: "List ALL senators for a given constitutional period (cuatrienio) of the Senado de la República. Returns senators with name, party, province and photo, paginated. Use senado_senadores_periodos first to see valid periods and counts. Use for 'quiénes son los senadores del periodo 2020-2024', 'lista de senadores actuales'.",
  inputSchema: {
    type: "object",
    properties: {
      periodo: { type: "string", enum: ["2010-2016", "2016-2020", "2020-2024", "2024-2028"], description: "Constitutional period (e.g. '2024-2028' for the current senators)" },
      page: { type: "number", description: "Page number, 0-based (default 0)" },
      size: { type: "number", description: "Page size (default 40, max 100)" },
    },
    required: ["periodo"],
  },
  annotations: { title: "Senadores por Periodo", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Listing senators for period ${args.periodo}...`);
    const result = await client.silSenadoSenadoresPeriodo(args.periodo, args.page ?? 0, args.size ?? 40);
    if (notify) notify("info", `Found ${result.total} senators in ${args.periodo}`);
    return result;
  },
});

registerTool({
  name: "senado_senador",
  description: "Fetch a single senator's full record from the Senado directory by DSpace item UUID (as returned by senado_senadores / senado_senadores_periodo). Returns name, party, province, period, handle URI and photo.",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Senator DSpace item UUID" },
    },
    required: ["itemId"],
  },
  annotations: { title: "Detalle de Senador", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Fetching senator: ${args.itemId}`);
    return client.silSenadoSenador(args.itemId);
  },
});

registerTool({
  name: "senado_expediente",
  description: "Fetch a SINGLE Senado DSpace expediente (iniciativa / proyecto de ley / resolución) by its DSpace item UUID — full metadata (número, tipo, descripción, estado, fecha, materia), its legislative classification (colección → comunidad → repositorio), its attached PDFs (each with a canDownload flag) and related items, with NO broad search. Use this for a specific known record (e.g. 'dame el detalle del expediente X' or 'los documentos del expediente Y') instead of senado_search, which scans the whole repository. The item UUID comes from senado_search / senado_senadores results (the 'id' field).",
  inputSchema: {
    type: "object",
    properties: {
      itemId: { type: "string", description: "Senado DSpace item UUID (e.g. c1864891-032e-4647-99ed-891e8c932aa1)" },
    },
    required: ["itemId"],
  },
  annotations: { title: "Expediente Senado (detalle)", readOnlyHint: true },
  async run(args, client, notify) {
    if (notify) notify("info", `Fetching Senado expediente: ${args.itemId}`);
    return client.silSenadoExpediente(args.itemId);
  },
});

export class McpServer {
  private readonly client: IntelDomGobClient;
  private readonly port: number;
  private readonly apiBaseUrl: string;
  private readonly apiToken: string;
  private app = express();

  constructor(opts: McpServerOptions) {
    this.apiBaseUrl = opts.apiBaseUrl;
    this.apiToken = opts.token;
    this.client = createClient({ baseUrl: opts.apiBaseUrl, token: opts.token, product: "mcp" });
    this.port = opts.port ?? 4100;

    // Derive the per-institution search tools from the SDK (no service import).
    // Awaited so the registry is complete before the server starts serving.
    // Failures fall back to a static institution list (see registerInstitutionTools).
    registerInstitutionTools(this.client).catch((e) =>
      log.warn("Institution tool registration failed", { error: (e as Error)?.message }),
    );

    this.app.use(express.json());

    // Legacy INTEL.DOM.GOB JSON-RPC surface (internal clients).
    this.app.post("/", (req, res) => this.handle(req.body, res));

    // Official MCP-protocol surface (Streamable HTTP + SSE) so standard MCP
    // clients like Odysseus, Claude Desktop and VS Code can connect. Reuses the
    // exact same tool registry — no second source of truth. The originating
    // client surface (X-Intel-Client) is forwarded to the API so a CLI → MCP →
    // API request is attributed to `cli`, not `mcp`.
    mountMcpProtocol(this.app, (product) =>
      createClient({ baseUrl: this.apiBaseUrl, token: this.apiToken, product: product || "mcp" }),
    );

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
    // Forward the originating client surface (CLI → MCP → API records `cli`).
    const inbound = (res.req as any)?.headers?.["x-intel-client"];
    const product = typeof inbound === "string" ? inbound.trim().toLowerCase() : undefined;
    const client = product
      ? createClient({ baseUrl: this.apiBaseUrl, token: this.apiToken, product })
      : this.client;
    try {
      if (method === "tools/list") {
        return res.json({
          jsonrpc: "2.0",
          id,
          result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) })) },
        });
      }
      if (method === "tools/call") {
        const tool = tools.find((t) => t.name === params?.name);
        if (!tool) return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool ${params?.name}` } });
        try {
          const output = await tool.run(params?.arguments ?? {}, client);
          return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output ?? "<no result>", null, 2) }] } });
        } catch (e: any) {
          return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Tool error: ${e?.message ?? String(e)}` }], isError: true } });
        }
      }
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e: any) {
      log.error("MCP request failed", { method, error: e.message });
      return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e.message }], isError: true } });
    }
  }

  start(): void {
    this.app.listen(this.port, "0.0.0.0", () => {
      log.info("MCP server listening", { port: this.port, toolCount: tools.length });
    });
  }
}

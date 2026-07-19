// INTEL.DOM.GOB SDK — the one and only way clients communicate with the API.
//
// Studio, Web, CLI, Admin and the MCP server ALL consume the platform through
// this client. No client ever talks to a service or provider directly.
//
// The client is transport-agnostic at the call site: it speaks plain HTTP to
// the API gateway (api.intel.dom.gob) and works identically in the browser and
// in Node.

import type {
  IntelligenceResult,
  QueryRequest,
  ChatRequest,
  InstitutionDescriptor,
  HealthStatus,
} from "./types";

export interface SdkOptions {
  /** Base URL of the API, e.g. https://api.intel.dom.gob or http://api.localhost. */
  baseUrl: string;
  /** Optional bearer/API-key token. */
  token?: string;
  /** API version prefix, defaults to "v1". */
  version?: string;
  fetchImpl?: typeof fetch;
}

export class IntelDomGobClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly version: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SdkOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.version = opts.version ?? "v1";
    // Bind fetch to the global (window) so it is never invoked as a detached
    // method — calling a bare `fetch` reference later throws "Illegal invocation".
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  private url(path: string): string {
    return `${this.baseUrl}/${this.version}${path.startsWith("/") ? path : "/" + path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  async health(): Promise<HealthStatus> {
    const res = await this.fetchImpl(this.url("/health"), { headers: this.headers() });
    return (await res.json()) as HealthStatus;
  }

  /** Dynamic discovery of institution plugins. */
  async listInstitutions(): Promise<InstitutionDescriptor[]> {
    const res = await this.fetchImpl(this.url("/institutions"), { headers: this.headers() });
    const data = (await res.json().catch(() => ({}))) as { institutions?: InstitutionDescriptor[] };
    if (!Array.isArray(data.institutions)) {
      // Never let a malformed/empty response surface as `{}` upstream.
      // Return an explicit empty array and surface the anomaly for debugging.
      console.warn("[sdk] listInstitutions: unexpected payload", data);
      return [];
    }
    return data.institutions;
  }

  /** Categorized URL tree for the source selector. */
  async getUrlTree(opts: { refresh?: boolean; portals?: string[] } = {}): Promise<{ portals: any[] }> {
    const params = new URLSearchParams();
    if (opts.refresh) params.set("refresh", "1");
    if (opts.portals && opts.portals.length) params.set("portals", opts.portals.join(","));
    const qs = params.toString();
    const res = await this.fetchImpl(this.url(`/url-tree${qs ? "?" + qs : ""}`), { headers: this.headers() });
    return (await res.json()) as { portals: any[] };
  }

  /** Run a multi-agent intelligence query. Returns the full structured result. */
  async query<T = IntelligenceResult>(req: QueryRequest): Promise<T> {
    const res = await this.fetchImpl(this.url("/query"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(err.message ?? err.error ?? `Query failed with ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Context-grounded follow-up chat over a completed IntelligenceResult. */
  async chat(req: ChatRequest): Promise<{ reply: string }> {
    const res = await this.fetchImpl(this.url("/chat"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(err.message ?? err.error ?? `Chat failed with ${res.status}`);
    }
    return (await res.json()) as { reply: string };
  }

  /**
   * Stream a query via Server-Sent Events. The `onEvent` callback receives each
   * parsed event ({ type, ... }). Resolves when the stream ends.
   */
  async queryStream(req: QueryRequest, onEvent: (event: any) => void): Promise<void> {
    const res = await this.fetchImpl(this.url("/query/stream"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(err.message ?? err.error ?? `Stream failed with ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const lines = part.split("\n");
        let eventType = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) {
          try {
            onEvent({ type: eventType, ...JSON.parse(dataLines.join("\n")) });
          } catch {
            onEvent({ type: eventType, raw: dataLines.join("\n") });
          }
        }
      }
    }
  }

  /** Fetch the auto-generated OpenAPI document. */
  async openApi(): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(this.url("/openapi.json"), { headers: this.headers() });
    return (await res.json()) as Record<string, unknown>;
  }

  /** List the tools exposed by the INTEL.DOM.GOB MCP server. */
  async mcpTools(): Promise<{ server: string; transport: string; tools: any[] }> {
    const res = await this.fetchImpl(this.url("/mcp/tools"), { headers: this.headers() });
    return (await res.json()) as { server: string; transport: string; tools: any[] };
  }

  // --- Direct institution data methods (for MCP tools) --------------------------
  // Both chambers have their own SIL (Sistema de Información Legislativa):
  //   - Cámara SIL: diputadosrd.gob.do/sil/api/
  //   - Senado SIL: memoriahistorica.senadord.gob.do/server/api (DSpace)

  /** Search Cámara SIL for legislative initiatives by keyword. */
  async silCamaraIniciativas(query: string, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query, periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativas?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** List Cámara SIL comisiones by tipo. */
  async silCamaraComisiones(tipoId?: number, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    if (tipoId) params.set("tipoId", String(tipoId));
    const res = await this.fetchImpl(this.url(`/sil/camara/comisiones?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** List Cámara SIL committee types (Permanentes, Especiales, etc.). */
  async silCamaraComisionTipos(periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/comision/tipo?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Get total count of Cámara SIL initiatives. */
  async silCamaraIniciativaCount(periodoId = 0): Promise<{ total: number }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/count?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number };
  }

  /** List Cámara SIL initiative topic groups (15 groups). */
  async silCamaraIniciativaGrupos(periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/grupos?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** List Cámara SIL matters (materias) within a topic group. */
  async silCamaraIniciativaMaterias(grupo: number, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ grupo: String(grupo), periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/materias?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Search Cámara SIL sesiones by keyword. */
  async silCamaraSesiones(query: string, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query, periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/sesiones?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** List or search Cámara SIL grupos parlamentarios. */
  async silCamaraGrupos(periodoId = 0, keyword = ""): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    if (keyword) params.set("query", keyword);
    const res = await this.fetchImpl(this.url(`/sil/camara/grupos?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Search Cámara SIL legisladores by name. */
  async silCamaraLegislador(query: string, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query, periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/legislador?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Search Senado SIL (DSpace) iniciativas + resoluciones. */
  async silSenadoIniciativas(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/sil/senado/iniciativas?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Search Senado SIL (DSpace) boletines + actas + informes. */
  async silSenadoBoletines(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/sil/senado/boletines?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Search Senado SIL (DSpace) resoluciones only. */
  async silSenadoResoluciones(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/sil/senado/resoluciones?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Search Senado WordPress press/news (not SIL). */
  async senadoNews(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/senado/news?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; results: any[] };
  }

  /** Full-text search across Senado DSpace (Memoria Histórica). scope: 'root' (all ~32k items), 'iniciativas' (legislative only), or 'all' (no scope filter). */
  async silSenadoSearch(query: string, scope: "root" | "iniciativas" | "all" = "root", maxResults = 20): Promise<{ total: number; scope: string; results: any[] }> {
    const params = new URLSearchParams({ query, scope, maxResults: String(maxResults) });
    const res = await this.fetchImpl(this.url(`/sil/senado/search?${params}`), { headers: this.headers() });
    return (await res.json()) as { total: number; scope: string; results: any[] };
  }

  /** Browse the Senado DSpace community tree (sub-communities and collections). parentId defaults to root. */
  async silSenadoCommunities(parentId?: string): Promise<{ parentId: string; subCommunities: any[]; collections: any[] }> {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    const qs = params.toString();
    const res = await this.fetchImpl(this.url(`/sil/senado/communities${qs ? "?" + qs : ""}`), { headers: this.headers() });
    return (await res.json()) as { parentId: string; subCommunities: any[]; collections: any[] };
  }

  /** List items in a specific Senado DSpace collection. */
  async silSenadoCollectionItems(collectionId: string, query = "", maxResults = 20): Promise<{ collectionId: string; total: number; results: any[] }> {
    const params = new URLSearchParams({ query, maxResults: String(maxResults) });
    const res = await this.fetchImpl(this.url(`/sil/senado/collections/${collectionId}/items?${params}`), { headers: this.headers() });
    return (await res.json()) as { collectionId: string; total: number; results: any[] };
  }

  /** Query the Knowledge Graph (optionally the neighborhood of one entity). */
  async graph(entity?: string): Promise<{ graph: any; neighbors?: any[] }> {
    const qs = entity ? `?entity=${encodeURIComponent(entity)}` : "";
    const res = await this.fetchImpl(this.url(`/graph${qs}`), { headers: this.headers() });
    return (await res.json()) as { graph: any; neighbors?: any[] };
  }

  /** Ingest an IntelligenceResult packet into the Knowledge Graph. */
  async graphIngest(result: unknown): Promise<{ entities: number; relations: number }> {
    const res = await this.fetchImpl(this.url("/graph/ingest"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(result),
    });
    return (await res.json()) as { entities: number; relations: number };
  }
}

export function createClient(opts: SdkOptions): IntelDomGobClient {
  return new IntelDomGobClient(opts);
}

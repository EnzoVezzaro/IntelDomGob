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
  FetchedPage,
} from "./types";

/** Result of `GET /v1/key/verify`. Mirrors the API response. */
export interface KeyVerification {
  /** `true` when the request carried a valid (non-preview) API key. */
  valid: boolean;
  /** Billing plan bound to the key (publico|investigador|pro|institucional|free). */
  plan: string;
  /** Scopes the key is authorized for. */
  scopes: string[];
  /** Daily metered-request quota (0 = unlimited). */
  quotaDaily: number;
  /** Requests-per-minute rate limit (0 = unlimited). */
  rateLimit: number;
  /** Client surface the key authenticates. */
  product: string;
  /** API-key record id ("preview" for the anonymous Público tier). */
  keyId: string;
}

export interface SdkOptions {
  /** Base URL of the API, e.g. https://api.intel.dom.gob or http://api.localhost. */
  baseUrl: string;
  /** Optional bearer/API-key token. */
  token?: string;
  /** API version prefix, defaults to "v1". */
  version?: string;
  /**
   * Originating client surface (studio | web | cli | mcp | sdk | admin | custom).
   * Forwarded to the API as `X-Intel-Client` so usage is attributed to the real
   * client, not an intermediate hop. The API treats this header as authoritative
   * (it overrides the API key's stored product), so a client that calls *through*
   * another client (e.g. CLI → MCP server → API) should forward the original
   * surface rather than stamp its own.
   */
  product?: string;
  fetchImpl?: typeof fetch;
}

export class IntelDomGobClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly version: string;
  private readonly product?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SdkOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.version = opts.version ?? "v1";
    this.product = opts.product;
    // Bind fetch to the global (window) so it is never invoked as a detached
    // method — calling a bare `fetch` reference later throws "Illegal invocation".
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  private url(path: string): string {
    return `${this.baseUrl}/${this.version}${path.startsWith("/") ? path : "/" + path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.product) h["X-Intel-Client"] = this.product;
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  /** Same as `headers()`, but with an optional per-call key override. */
  private headersWithOverride(key: string | undefined, extra?: Record<string, string>): Record<string, string> {
    const h = { ...(extra ?? {}) };
    if (this.product) h["X-Intel-Client"] = this.product;
    const token = key ?? this.token;
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  /** Check that a fetch response is OK; throw a meaningful error otherwise. */
  private async requireOk(res: Response): Promise<any> {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(body.message ?? body.error ?? `HTTP ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async health(): Promise<HealthStatus> {
    const res = await this.fetchImpl(this.url("/health"), { headers: this.headers() });
    return this.requireOk(res);
  }

  /**
   * Verify the caller's API key against the platform.
   *
   * Calls `GET /v1/key/verify`. With no token (`Bearer` header omitted) the
   * API returns the Público preview record (`valid: false`). With a present
   * but invalid key the API returns 401 (throws here with the API's message).
   * With a valid key it returns tier metadata (plan, scopes, quota, rate).
   *
   * Use this during client onboarding (CLI / Studio) to confirm a key is
   * live and to show a resume ("Plan: Investigador · 200/day") before the
   * first real query.
   *
   * Pass `confirmKey` to override the client's stored token for this single
   * call — used by the MCP server's `verify_key` tool so a client can verify
   * its own candidate key (different from the MCP server's platform token)
   * without the MCP server having to build a fresh client itself.
   */
  async verifyKey(confirmKey?: string): Promise<KeyVerification> {
    const res = await this.fetchImpl(this.url("/key/verify"), { headers: this.headersWithOverride(confirmKey) });
    return this.requireOk(res);
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

  /** Search a specific institution by ID. */
  async searchInstitution(id: string, query: string): Promise<{ id: string; name: string; results: any[] }> {
    const res = await this.fetchImpl(this.url(`/institutions/${id}/search?q=${encodeURIComponent(query)}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Categorized URL tree for the source selector. */
  async getUrlTree(opts: { refresh?: boolean; portals?: string[] } = {}): Promise<{ portals: any[] }> {
    const params = new URLSearchParams();
    if (opts.refresh) params.set("refresh", "1");
    if (opts.portals && opts.portals.length) params.set("portals", opts.portals.join(","));
    const qs = params.toString();
    const res = await this.fetchImpl(this.url(`/url-tree${qs ? "?" + qs : ""}`), { headers: this.headers() });
    return this.requireOk(res);
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
    return this.requireOk(res);
  }

  /**
   * Fetch a single web page and return its readable text + metadata.
   * POST /v1/fetch
   */
  async fetchUrl(url: string, opts: { timeoutMs?: number; maxChars?: number } = {}): Promise<{
    url: string;
    title: string;
    text: string;
    publishedDate: string | null;
    dominican: boolean;
  } | null> {
    const res = await this.fetchImpl(this.url("/fetch"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url, timeoutMs: opts.timeoutMs, maxChars: opts.maxChars }),
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 502) return null;
      throw new Error(`fetchUrl failed with ${res.status}`);
    }
    return (await res.json()) as any;
  }

  /** List the tools exposed by the INTEL.DOM.GOB MCP server. */
  async mcpTools(): Promise<{ server: string; transport: string; tools: any[] }> {
    const res = await this.fetchImpl(this.url("/mcp/tools"), { headers: this.headers() });
    return this.requireOk(res);
  }

  // --- Direct institution data methods (for MCP tools) --------------------------
  // Both chambers have their own SIL (Sistema de Información Legislativa):
  //   - Cámara SIL: diputadosrd.gob.do/sil/api/
  //   - Senado SIL: memoriahistorica.senadord.gob.do/server/api (DSpace)

  /** Search Cámara SIL for legislative initiatives by keyword. */
  async silCamaraIniciativas(query: string, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query, periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativas?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Fetch the full detail of a single Cámara SIL initiative by its numeric ID. */
  async silCamaraIniciativaDetalle(id: number, periodoId = 0): Promise<any> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/${id}?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Fetch the FULL detail of a Cámara SIL initiative: base object + proponentes, historicos, comisiones, documentos, votaciones. */
  async silCamaraIniciativaCompleta(id: number, periodoId = 0): Promise<any> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/${id}/completa?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /**
   * Fetch a SINGLE related sub-resource of a Cámara SIL initiative by ID,
   * without pulling the whole bundle. sub ∈ proponentes | historicos |
   * comisiones | actividades | documentos | votaciones. Use this for specific
   * questions (e.g. "list the documents of this initiative").
   */
  async silCamaraIniciativaSub(sub: string, id: number, periodoId = 0): Promise<any> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/${id}/${sub}?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List Cámara SIL comisiones by tipo. */
  async silCamaraComisiones(tipoId?: number, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    if (tipoId) params.set("tipoId", String(tipoId));
    const res = await this.fetchImpl(this.url(`/sil/camara/comisiones?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List Cámara SIL committee types (Permanentes, Especiales, etc.). */
  async silCamaraComisionTipos(periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/comision/tipo?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Get total count of Cámara SIL initiatives. */
  async silCamaraIniciativaCount(periodoId = 0): Promise<{ total: number }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/count?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List Cámara SIL initiative topic groups (15 groups). */
  async silCamaraIniciativaGrupos(periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/grupos?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List Cámara SIL matters (materias) within a topic group. */
  async silCamaraIniciativaMaterias(grupo: number, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ grupo: String(grupo), periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/iniciativa/materias?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Search Cámara SIL sesiones by keyword. */
  async silCamaraSesiones(query: string, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query, periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/sesiones?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List or search Cámara SIL grupos parlamentarios. */
  async silCamaraGrupos(periodoId = 0, keyword = ""): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ periodoId: String(periodoId) });
    if (keyword) params.set("query", keyword);
    const res = await this.fetchImpl(this.url(`/sil/camara/grupos?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Search Cámara SIL legisladores by name. */
  async silCamaraLegislador(query: string, periodoId = 0): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query, periodoId: String(periodoId) });
    const res = await this.fetchImpl(this.url(`/sil/camara/legislador?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Search Senado SIL (DSpace) iniciativas + resoluciones. */
  async silSenadoIniciativas(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/sil/senado/iniciativas?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Search Senado SIL (DSpace) boletines + actas + informes. */
  async silSenadoBoletines(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/sil/senado/boletines?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Search Senado SIL (DSpace) resoluciones only. */
  async silSenadoResoluciones(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/sil/senado/resoluciones?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Search Senado WordPress press/news (not SIL). */
  async senadoNews(query: string): Promise<{ total: number; results: any[] }> {
    const params = new URLSearchParams({ query });
    const res = await this.fetchImpl(this.url(`/senado/news?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Full-text search across Senado DSpace (Memoria Histórica). scope: 'root' (all ~32k items), 'iniciativas' (legislative only), or 'all' (no scope filter). */
  async silSenadoSearch(query: string, scope: "root" | "iniciativas" | "all" = "root", maxResults = 20): Promise<{ total: number; scope: string; results: any[] }> {
    const params = new URLSearchParams({ query, scope, maxResults: String(maxResults) });
    const res = await this.fetchImpl(this.url(`/sil/senado/search?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Browse the Senado DSpace community tree (sub-communities and collections). parentId defaults to root. */
  async silSenadoCommunities(parentId?: string): Promise<{ parentId: string; subCommunities: any[]; collections: any[] }> {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    const qs = params.toString();
    const res = await this.fetchImpl(this.url(`/sil/senado/communities${qs ? "?" + qs : ""}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List items in a specific Senado DSpace collection. */
  async silSenadoCollectionItems(collectionId: string, query = "", maxResults = 20): Promise<{ collectionId: string; total: number; results: any[] }> {
    const params = new URLSearchParams({ query, maxResults: String(maxResults) });
    const res = await this.fetchImpl(this.url(`/sil/senado/collections/${collectionId}/items?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  // --- Cronológico de Senadores (senator directory) ------------------------

  /** Search senators by name across all periods, or within one period (e.g. "2020-2024"). Returns name, party, province, quadrennium and photo. */
  async silSenadoSenadores(query: string, periodo?: string, maxResults = 20): Promise<{ total: number; periodo: string; results: any[] }> {
    const params = new URLSearchParams({ query, maxResults: String(maxResults) });
    if (periodo) params.set("periodo", periodo);
    const res = await this.fetchImpl(this.url(`/sil/senado/senadores?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List the available constitutional periods with a senator count for each. */
  async silSenadoSenadoresPeriodos(): Promise<{ total: number; periodos: Array<{ periodo: string; collectionId: string; total: number }> }> {
    const res = await this.fetchImpl(this.url("/sil/senado/senadores/periodos"), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** List all senators for a given constitutional period (paginated). */
  async silSenadoSenadoresPeriodo(periodo: string, page = 0, size = 40): Promise<{ periodo: string; total: number; results: any[] }> {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    const res = await this.fetchImpl(this.url(`/sil/senado/senadores/periodo/${encodeURIComponent(periodo)}?${params}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Fetch a single senator's full record by DSpace item UUID. */
  async silSenadoSenador(itemId: string): Promise<any> {
    const res = await this.fetchImpl(this.url(`/sil/senado/senadores/${encodeURIComponent(itemId)}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /**
   * Fetch a SINGLE Senado DSpace expediente by its item UUID — full metadata
   * plus attached PDFs — without running a broad search. Use for a specific
   * known record (e.g. "dame el detalle del expediente X").
   */
  async silSenadoExpediente(itemId: string): Promise<any> {
    const res = await this.fetchImpl(this.url(`/sil/senado/expediente/${encodeURIComponent(itemId)}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Query the Knowledge Graph (optionally the neighborhood of one entity). */
  async graph(entity?: string): Promise<{ graph: any; neighbors?: any[] }> {
    const qs = entity ? `?entity=${encodeURIComponent(entity)}` : "";
    const res = await this.fetchImpl(this.url(`/graph${qs}`), { headers: this.headers() });
    return this.requireOk(res);
  }

  /** Ingest an IntelligenceResult packet into the Knowledge Graph. */
  async graphIngest(result: unknown): Promise<{ entities: number; relations: number }> {
    const res = await this.fetchImpl(this.url("/graph/ingest"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(result),
    });
    return this.requireOk(res);
  }
}

export function createClient(opts: SdkOptions): IntelDomGobClient {
  return new IntelDomGobClient(opts);
}

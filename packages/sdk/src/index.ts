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
    const data = (await res.json()) as { institutions: InstitutionDescriptor[] };
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

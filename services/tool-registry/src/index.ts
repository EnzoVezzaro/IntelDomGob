// services/tool-registry
//
// A registry of declarative tools that agents / the orchestrator / the MCP
// server can discover and invoke. A tool is:
//   - id, name, description
//   - params: a JSON-schema-ish record for validation
//   - execute: (args, ctx) => unknown
//   - category / risk (for ABAC gating)
//
// The registry is the single place where tools are registered; no higher layer
// calls an executor directly. Registration is idempotent (re-register = replace).

export type ToolRisk = "low" | "medium" | "high";

export interface ToolParam {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
}

export interface ToolContext {
  /** Opaque request context (requestId, scopes, etc.) passed from the caller. */
  request?: unknown;
  /** Convenience handle to other services if needed. */
  services?: Record<string, unknown>;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  risk: ToolRisk;
  params: Record<string, ToolParam>;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  unregister(id: string): boolean {
    return this.tools.delete(id);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** Validate args against the declared param schema. Throws on violation. */
  private validate(tool: Tool, args: Record<string, unknown>): void {
    for (const [key, spec] of Object.entries(tool.params)) {
      const value = args[key];
      if (spec.required && (value === undefined || value === null)) {
        throw new Error(`Missing required parameter: ${key}`);
      }
      if (value !== undefined && value !== null) {
        const actual = Array.isArray(value) ? "array" : typeof value;
        const expected = spec.type === "array" ? "array" : spec.type;
        if (actual !== expected) {
          throw new Error(`Parameter ${key} expected ${expected}, got ${actual}`);
        }
      }
    }
  }

  async execute(id: string, args: Record<string, unknown>, ctx: ToolContext = {}): Promise<unknown> {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Tool not found: ${id}`);
    this.validate(tool, args ?? {});
    return tool.execute(args ?? {}, ctx);
  }
}

/** Default tools available out of the box (read-only, low risk). */
export function createDefaultToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register({
    id: "web.search",
    name: "Web Search",
    description: "Search the web for current information via the configured search provider.",
    category: "retrieval",
    risk: "low",
    params: {
      query: { type: "string", required: true, description: "Search query" },
      limit: { type: "number", description: "Max results" },
    },
    execute: async (args) => ({ query: args.query, note: "execute via SearchService" }),
  });
  reg.register({
    id: "entities.extract",
    name: "Extract Entities",
    description: "Extract structured entities and relations from text.",
    category: "nlp",
    risk: "low",
    params: { text: { type: "string", required: true } },
    execute: async (args) => ({ text: args.text, note: "execute via EntitiesService" }),
  });
  return reg;
}

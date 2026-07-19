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
  run(args: any, client: IntelDomGobClient): Promise<unknown>;
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
  description: "Run a multi-agent Dominican government intelligence query.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" }, institutions: { type: "array", items: { type: "string" } } },
    required: ["query"],
  },
  async run(args, client) {
    return client.query({ query: args.query, institutions: args.institutions });
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

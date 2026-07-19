// services/mcp/src/mcp-protocol.ts
//
// Real MCP-protocol (Model Context Protocol) transport for the INTEL.DOM.GOB
// MCP server. The platform's existing tool registry (registerTool / tools[]) is
// reused verbatim — this module only adds a protocol-compliant surface so
// standard MCP clients (Odysseus, Claude Desktop, VS Code, etc.) can connect
// without knowing about our internal JSON-RPC shape.
//
// Transport: Streamable HTTP (POST + SSE per the 2025-03-26 MCP spec), with
// an SSE fallback on GET for older clients (e.g. Odysseus `odysseus-mcp add
// --transport sse`). No new dependencies — Express + Node stdlib only.
//
// IMPORTANT: the MCP server remains a pure CLIENT of the API. Every tool
// invocation still flows through the INTEL.DOM.GOB SDK (see index.ts). This
// file never imports a service or provider directly.

import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { tools, type McpTool } from "./index";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = "2025-03-26";

// Wrap a tool's raw return value into MCP content blocks. MCP requires
// `content: [{ type: "text", text: string }]`; we JSON-stringify anything
// else so clients always receive a stable, parseable text payload.
function toContent(value: unknown): { type: "text"; text: string }[] {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (value && typeof value === "object" && "content" in (value as any)) {
    // Already an MCP-shaped result (defensive) — pass through.
    return (value as any).content;
  } else {
    text = JSON.stringify(value, null, 2);
  }
  return [{ type: "text", text }];
}

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: JsonRpcResponse["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Dispatch a single JSON-RPC request according to the MCP method set.
// Returns null for notifications (no id) where no response should be sent.
async function dispatch(req: JsonRpcRequest, client: any): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const method = req.method ?? "";
  const params = req.params ?? {};

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "intel-dom-gob", version: "1.0.0" },
      });

    case "notifications/initialized":
    case "ping":
      // Notifications / pings: no response body.
      return id === null ? null : ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: tools.map((t: McpTool) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        })),
      });

    case "tools/call": {
      const tool = tools.find((t: McpTool) => t.name === params?.name);
      if (!tool) return err(id, -32601, `Unknown tool ${params?.name ?? "(none)"}`);
      try {
        const output = await tool.run(params?.arguments ?? {}, client);
        // Guard against a tool returning undefined/null (which would otherwise
        // serialize to `{}` and confuse MCP clients). Emit a clear placeholder.
        const safe = output === undefined || output === null ? "<no result>" : output;
        return ok(id, { content: toContent(safe), isError: false });
      } catch (e: any) {
        return ok(id, { content: toContent(`Tool error: ${e?.message ?? String(e)}`), isError: true });
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Mount the MCP-protocol endpoints onto an Express app.
 *   POST /mcp           Streamable HTTP (JSON-RPC batch + SSE streaming)
 *   GET  /mcp           SSE stream (for `sse` transport clients)
 *   DELETE /mcp         session teardown (spec-compliant no-op here)
 *
 * @param app        Express instance
 * @param makeClient factory returning a fresh SDK client per request
 * @param basePath   mount path (default "/mcp")
 */
export function mountMcpProtocol(app: Express, makeClient: () => any, basePath = "/mcp"): void {
  // SSE transport (legacy MCP "sse" used by Odysseus `--transport sse`):
  //   1. Client opens GET /mcp  → server sends `event: endpoint` with a
  //      session-scoped POST URL (containing ?sessionId=), and keeps the
  //      stream open.
  //   2. Client POSTs JSON-RPC messages to that URL → server dispatches and
  //      writes the JSON-RPC response back onto the open SSE stream.
  // This matches the MCP SSE client contract (responses arrive in-order on
  // the originating SSE connection, not on the POST response body).
  const sessions = new Map<string, { res: any; ping: NodeJS.Timeout }>();

  app.get(basePath, async (_req, res) => {
    const sessionId = randomUUID();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Mcp-Session-Id": sessionId,
    });
    // The POST URL the client should send messages to.
    res.write(`event: endpoint\ndata: ${basePath}?sessionId=${sessionId}\n\n`);

    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    sessions.set(sessionId, { res, ping });
    res.on("close", () => {
      clearInterval(ping);
      sessions.delete(sessionId);
    });
  });

  // Streamable HTTP POST: if a ?sessionId is present (legacy SSE flow) write
  // the response into that session's open SSE stream; otherwise respond
  // inline as SSE (modern Streamable HTTP clients).
  app.post(basePath, async (req, res) => {
    const wantsSse = String(req.headers.accept ?? "").includes("text/event-stream");
    const sessionId = String(req.query?.sessionId ?? "");
    const body = req.body as JsonRpcRequest | JsonRpcRequest[];
    const requests = Array.isArray(body) ? body : [body];

    const respond = async (): Promise<JsonRpcResponse[]> => {
      const client = makeClient();
      const results: JsonRpcResponse[] = [];
      for (const r of requests) {
        const out = await dispatch(r, client);
        if (out) results.push(out);
      }
      return results;
    };

    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (session) {
      // Legacy SSE: stream the response(s) back on the open GET connection.
      const results = await respond();
      for (const r of results) {
        session.res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
      }
      res.status(202).end();
      return;
    }

    if (wantsSse) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Mcp-Session-Id": randomUUID(),
      });
      const results = await respond();
      for (const r of results) {
        res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
      }
      res.end();
      return;
    }

    const results = await respond();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Mcp-Session-Id", randomUUID());
    res.json(Array.isArray(body) ? results : results[0] ?? ok(null, {}));
  });

  app.delete(basePath, (_req, res) => {
    res.setHeader("Mcp-Session-Id", randomUUID());
    res.status(200).end();
  });
}

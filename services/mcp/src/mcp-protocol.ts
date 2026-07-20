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
import { tools, type McpTool, type ProgressNotifier } from "./index";

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
// `sendNotification` writes MCP notifications/message to the transport.
async function dispatch(req: JsonRpcRequest, client: any, sendNotification?: (notification: JsonRpcResponse) => void): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const method = req.method ?? "";
  const params = req.params ?? {};

  // Build a ProgressNotifier that sends notifications/message to the client.
  const notify: ProgressNotifier | undefined = sendNotification
    ? (level, message, extra) => {
        sendNotification({
          jsonrpc: "2.0",
          id: null, // notification (no response expected)
          method: "notifications/message",
          result: { level, data: message, ...extra },
        } as any);
      }
    : undefined;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "intel-dom-gob", version: "1.0.0" },
      });

    case "notifications/initialized":
      // Notifications: spec says "The server MUST NOT respond" — always null.
      return null;

    case "ping":
      return id === null ? null : ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: tools.map((t: McpTool) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: "object", properties: {} },
          ...(t.annotations ? { annotations: t.annotations } : {}),
        })),
      });

    case "tools/call": {
      const tool = tools.find((t: McpTool) => t.name === params?.name);
      if (!tool) return err(id, -32601, `Unknown tool ${params?.name ?? "(none)"}`);
      try {
        const output = await tool.run(params?.arguments ?? {}, client, notify);
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
 * @param makeClient factory returning a fresh SDK client per request; receives
 *                   the originating client surface (from the inbound
 *                   `X-Intel-Client` header) so it can be forwarded to the API.
 * @param basePath   mount path (default "/mcp")
 */
export function mountMcpProtocol(app: Express, makeClient: (product?: string) => any, basePath = "/mcp"): void {
  // Two transports share this mount point:
  //
  //  A) Legacy MCP "sse" (used by Odysseus `--transport sse`):
  //     1. Client opens GET /mcp (no session id) → server sends `event: endpoint`
  //        with a session-scoped POST URL (?sessionId=) and keeps the stream open.
  //     2. Client POSTs JSON-RPC to that URL → responses stream back on the GET SSE.
  //
  //  B) Streamable HTTP (2025-03-26; used by claude code, opencode, the official
  //     `mcp` SDK, and stock Odysseus-over-HTTP):
  //     1. Client POSTs `initialize` → server replies (SSE or JSON) with an
  //        `Mcp-Session-Id` response header.
  //     2. Client opens GET /mcp WITH that `Mcp-Session-Id` header → server streams
  //        server→client messages (`event: message`) on this SSE connection. This is
  //        REQUIRED by the spec: the client keeps this stream open for the whole
  //        session and reads server-initiated notifications here.
  //     3. Client POSTs requests (tools/list, tools/call, …) with the same header;
  //        the JSON-RPC response is returned on the POST response itself.
  const sseSessions = new Map<string, { res: any; ping: NodeJS.Timeout }>();

  // Streamable HTTP sessions: keyed by Mcp-Session-Id. Holds the open GET SSE
  // response (for server→client streaming) plus any messages queued before the
  // GET stream attached.
  const streamableSessions = new Map<string, { res: any | null; queue: any[]; ping: NodeJS.Timeout }>();

  // MCP-Session-Id store: tracks session ids assigned on `initialize` (for validation).
  const mcpSessions = new Map<string, {}>();

  function writeToSession(sid: string, message: any): void {
    const s = streamableSessions.get(sid);
    if (!s) return;
    const frame = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    if (s.res) s.res.write(frame);
    else s.queue.push(frame);
  }

  app.get(basePath, async (req, res) => {
    const headerSessionId = String(req.headers["mcp-session-id"] ?? "");
    console.error("MCP GET", { headerSessionId: headerSessionId || "(none)", hasStreamSession: streamableSessions.has(headerSessionId) });

    // ── Streamable HTTP mode: client attached with a session id ──────────────
    if (headerSessionId && streamableSessions.has(headerSessionId)) {
      const s = streamableSessions.get(headerSessionId)!;
      console.error("MCP GET streamable-attach", { headerSessionId });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Mcp-Session-Id": headerSessionId,
      });
      // Flush anything queued before this GET stream attached.
      for (const frame of s.queue) res.write(frame);
      s.queue = [];
      s.res = res;
      const ping = setInterval(() => { if (s.res) s.res.write(": ping\n\n"); }, 15000);
      s.ping = ping;
      res.on("close", () => {
        clearInterval(ping);
        s.res = null; // keep the session entry so POST responses still validate
      });
      return;
    }

    // ── Legacy SSE handshake ─────────────────────────────────────────────────
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
    sseSessions.set(sessionId, { res, ping });
    res.on("close", () => {
      clearInterval(ping);
      sseSessions.delete(sessionId);
    });
  });

  // Streamable HTTP POST: if a ?sessionId is present (legacy SSE flow) write
  // the response into that session's open SSE stream; otherwise respond
  // inline as SSE (modern Streamable HTTP clients).
  app.post(basePath, async (req, res) => {
    const wantsSse = String(req.headers.accept ?? "").includes("text/event-stream");
    const legacySessionId = String(req.query?.sessionId ?? "");
    const headerSessionId = String(req.headers["mcp-session-id"] ?? "");
    const body = req.body as JsonRpcRequest | JsonRpcRequest[];
    const requests = Array.isArray(body) ? body : [body];
    const firstMethod = requests[0]?.method ?? "";

    console.error("MCP POST", { method: firstMethod, headerSessionId: headerSessionId || "(none)", legacy: legacySessionId || "(none)", wantsSse });

    // Validate incoming Mcp-Session-Id header on non-initialize requests (MCP 2025-03-26).
    // Allow absent header for legacy/SSE clients; reject unknown values.
    if (headerSessionId && firstMethod !== "initialize") {
      if (!mcpSessions.has(headerSessionId)) {
        res.status(401).json({ error: "Invalid or expired Mcp-Session-Id" });
        return;
      }
    }

    // Resolve the active Streamable-HTTP session id (assigned at initialize, or
    // passed in by the client on subsequent requests). Used to route server→client
    // notifications onto the client's open GET SSE stream.
    const activeSid = (firstMethod === "initialize" && !headerSessionId)
      ? randomUUID()
      : (headerSessionId || "");

    // Register the session BEFORE we send the initialize response. The client
    // opens its GET /mcp (server→client SSE) immediately after receiving the
    // Mcp-Session-Id header, so the entry must exist by then — otherwise the GET
    // falls through to the legacy handshake and the transport tears down.
    if (firstMethod === "initialize" && !headerSessionId) {
      mcpSessions.set(activeSid, {});
      streamableSessions.set(activeSid, { res: null, queue: [], ping: setInterval(() => {}, 1e9) });
    }

    const respond = async (sendNotification?: (n: JsonRpcResponse) => void): Promise<JsonRpcResponse[]> => {
      // Forward the originating client surface (CLI → MCP → API records `cli`).
      // Absent header means the MCP server itself is the origin → default "mcp".
      const inbound = req.headers["x-intel-client"];
      const product = typeof inbound === "string" ? inbound.trim().toLowerCase() : undefined;
      const client = makeClient(product);
      const results: JsonRpcResponse[] = [];
      for (const r of requests) {
        const out = await dispatch(r, client, sendNotification);
        if (out) results.push(out);
      }
      return results;
    };

    const sseSession = legacySessionId ? sseSessions.get(legacySessionId) : undefined;
    if (sseSession) {
      // Legacy SSE: stream the response(s) back on the open GET connection.
      // Notifications are sent as SSE events during tool execution.
      const results = await respond((n) => sseSession.res.write(`event: message\ndata: ${JSON.stringify(n)}\n\n`));
      for (const r of results) {
        sseSession.res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
      }
      res.status(202).end();
      return;
    }

    if (wantsSse) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Mcp-Session-Id": activeSid,
      });
      // Notifications stream to the client's open GET /mcp (Streamable HTTP) stream.
      const results = await respond((n) => writeToSession(activeSid, n));
      for (const r of results) {
        res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
      }
      res.end();
      return;
    }

    // Plain JSON: notifications can't be streamed — tool runs synchronously.
    const allNotifications = requests.every((r) => r.id === null || r.id === undefined);
    const results = await respond((n) => writeToSession(activeSid, n));

    // Per MCP 2025-03-26 spec §2: "A notification is a JSON-RPC request with
    // id = null ... The server MUST NOT respond to a notification."
    if (allNotifications) {
      res.status(204).end();
      return;
    }

    res.setHeader("Content-Type", "application/json");

    if (activeSid) res.setHeader("Mcp-Session-Id", activeSid);

    res.json(Array.isArray(body) ? results : results[0] ?? ok(null, {}));
  });

  app.delete(basePath, (req, res) => {
    const headerSessionId = String(req.headers["mcp-session-id"] ?? "");
    if (headerSessionId) mcpSessions.delete(headerSessionId);
    res.status(200).end();
  });
}

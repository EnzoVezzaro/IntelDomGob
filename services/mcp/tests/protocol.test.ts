import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { mountMcpProtocol } from "../src/mcp-protocol";
import { tools, registerTool } from "../src/index";

// ── helpers ──────────────────────────────────────────────────────────────────

const JSONRPC = (id: number | string | null, method: string, params?: any) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });

type ReqInit = RequestInit & { url: string };
async function post(baseUrl: string, body: string | object, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ── spin up an Express app with mountMcpProtocol ─────────────────────────────

let server: import("node:http").Server;
let baseUrl: string;

before(async () => {
  // Register a test tool that always returns "hello" (idempotent if re-registered)
  const exists = tools.find((t: any) => t.name === "__test_ok");
  if (!exists) {
    registerTool({
      name: "__test_ok",
      description: "Test tool that returns a greeting",
      inputSchema: { type: "object", properties: {} },
      run: async () => "hello from test tool",
      annotations: { title: "Test Tool" },
    });
  }
  // Register a tool that always throws
  const throwExists = tools.find((t: any) => t.name === "__test_throw");
  if (!throwExists) {
    registerTool({
      name: "__test_throw",
      description: "Tool that always throws",
      inputSchema: { type: "object", properties: {} },
      run: async () => { throw new Error("boom"); },
    });
  }

  const app = express();
  app.use(express.json());
  mountMcpProtocol(app, () => ({}));

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}/mcp`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("MCP 2025-03-26 protocol compliance", () => {

  it("initialize returns protocolVersion, capabilities, serverInfo", async () => {
    const res = await post(baseUrl, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, 1);
    assert.equal(body.result.protocolVersion, "2025-03-26");
    assert.deepStrictEqual(body.result.capabilities, { tools: { listChanged: false } });
    assert.equal(body.result.serverInfo.name, "intel-dom-gob");
    assert.equal(typeof body.result.serverInfo.version, "string");
  });

  it("initialize returns Mcp-Session-Id header", async () => {
    const res = await post(baseUrl, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const sid = res.headers.get("mcp-session-id");
    assert.ok(sid, "Mcp-Session-Id header must be present");
    // Must be a valid UUID
    assert.match(sid, /^[0-9a-f-]{36}$/i, "Session id should be a UUID");
  });

  it("notifications/initialized returns no JSON body", async () => {
    // With id=null → notification → must return no body (null/empty)
    const res = await post(baseUrl, JSON.stringify({ jsonrpc: "2.0", id: null, method: "notifications/initialized" }));
    // Response could be 200 or 204; body should be empty or null
    const text = await res.text();
    // Either the body is empty or it's "null" (express json sends null for no value)
    assert.ok(text === "" || text === "null" || text === "{}" || text === "undefined",
      `notifications/initialized should not return a JSON-RPC result, got: ${text}`);
  });

  it("ping returns result:{} when id is provided", async () => {
    const res = await post(baseUrl, { jsonrpc: "2.0", id: 42, method: "ping" });
    const body = await res.json();
    assert.equal(body.id, 42);
    assert.deepStrictEqual(body.result, {});
    assert.equal(body.error, undefined);
  });

  it("tools/list returns tools with annotations (2025-03-26 shape)", async () => {
    const res = await post(baseUrl, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = await res.json();
    assert.ok(Array.isArray(body.result.tools));
    assert.ok(body.result.tools.length > 0);

    // Check our test tool has annotations with title
    const testTool = body.result.tools.find((t: any) => t.name === "__test_ok");
    assert.ok(testTool, "test tool __test_ok must be in tools/list");
    assert.ok(testTool.annotations, "annotations must be present");
    assert.equal(testTool.annotations.title, "Test Tool");
    assert.equal(testTool.inputSchema.type, "object");
    assert.equal(typeof testTool.description, "string");

    // Ensure no top-level "title" field (that's 2025-06-18)
    assert.equal(testTool.title, undefined, "Must not have top-level title");
  });

  it("tools/call returns isError:false on success", async () => {
    const res = await post(baseUrl, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "__test_ok", arguments: {} },
    });
    const body = await res.json();
    assert.equal(body.id, 3);
    assert.equal(body.result.isError, false);
    assert.ok(Array.isArray(body.result.content));
    assert.ok(body.result.content.length > 0);
    assert.equal(body.result.content[0].type, "text");
    assert.ok(body.result.content[0].text.includes("hello from test tool"));
  });

  it("tools/call returns isError:true on throw", async () => {
    const res = await post(baseUrl, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "__test_throw", arguments: {} },
    });
    const body = await res.json();
    assert.equal(body.id, 4);
    assert.equal(body.result.isError, true);
    assert.ok(body.result.content[0].text.includes("boom"));
  });

  it("unknown tool returns -32601 JSON-RPC error", async () => {
    const res = await post(baseUrl, {
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "nonexistent_tool", arguments: {} },
    });
    const body = await res.json();
    assert.equal(body.id, 5);
    assert.equal(body.error.code, -32601);
  });

  it("unknown method returns -32601", async () => {
    const res = await post(baseUrl, { jsonrpc: "2.0", id: 6, method: "nosuchmethod" });
    const body = await res.json();
    assert.equal(body.error.code, -32601);
  });

  it("POST with Accept: text/event-stream returns Content-Type: text/event-stream", async () => {
    const res = await post(baseUrl,
      { jsonrpc: "2.0", id: 7, method: "ping" },
      { Accept: "text/event-stream" },
    );
    assert.ok(res.headers.get("content-type")?.includes("text/event-stream"),
      "Must return SSE content type");
  });
});

describe("Mcp-Session-Id round-trip", () => {

  it("initialize assigns session id; known id is echoed back on subsequent POST", async () => {
    // Step 1: initialize → get session id
    const initRes = await post(baseUrl, { jsonrpc: "2.0", id: 10, method: "initialize", params: {} });
    const sid = initRes.headers.get("mcp-session-id");
    assert.ok(sid, "Session id must be assigned on initialize");

    // Step 2: ping with known session id → should echo it back
    const pingRes = await post(baseUrl,
      { jsonrpc: "2.0", id: 11, method: "ping" },
      { "Mcp-Session-Id": sid },
    );
    const pingBody = await pingRes.json();
    assert.equal(pingBody.id, 11);
    assert.equal(pingRes.headers.get("mcp-session-id"), sid, "Session id should be echoed");
  });

  it("unknown Mcp-Session-Id returns 401 on non-initialize request", async () => {
    const res = await post(baseUrl,
      { jsonrpc: "2.0", id: 12, method: "tools/list" },
      { "Mcp-Session-Id": "00000000-0000-0000-0000-000000000000" },
    );
    assert.equal(res.status, 401);
  });

  it("POST without Mcp-Session-Id header still works (legacy compat)", async () => {
    const res = await post(baseUrl, { jsonrpc: "2.0", id: 13, method: "tools/list" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.result.tools));
  });
});

describe("Legacy POST / handler", () => {

  it("tool errors return isError:true instead of -32000", async () => {
    // The legacy handler in index.ts handle() should now return isError:true
    // We can test it via the MCP protocol (which uses the legacy handler for non-SSE)
    const res = await post(baseUrl, {
      jsonrpc: "2.0", id: 20, method: "tools/call",
      params: { name: "__test_throw", arguments: {} },
    });
    const body = await res.json();
    assert.equal(body.result?.isError, true, "Tool error should use isError:true, not -32000 JSON-RPC error");
    assert.equal(body.error, undefined, "Must not have a top-level error object");
  });

  it("unknown tool returns -32601 (not isError)", async () => {
    const res = await post(baseUrl, {
      jsonrpc: "2.0", id: 21, method: "tools/call",
      params: { name: "no_such_tool_xyz", arguments: {} },
    });
    const body = await res.json();
    assert.equal(body.error?.code, -32601);
  });
});

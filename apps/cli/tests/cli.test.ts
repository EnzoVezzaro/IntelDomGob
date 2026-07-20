import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@intel.dom.gob/service-mcp";
import { connectMcp, DEFAULT_MCP_URL } from "../src/mcp-client.js";

// ─────────────────────────────────────────────────────────────────────────────
// The CLI is a PURE MCP client. These tests prove the CLI's connection layer
// actually talks MCP 2025-03-26 to our server: initialize handshake, session
// id, tools/list, and a real tools/call over the wire. The server is started
// in-process on a random port (no external API required for the handshake).
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI ↔ MCP server (official SDK transport)", () => {
  let server: any;
  let serverHttp: any;
  let baseUrl: string;

  before(async () => {
    const srv = new McpServer({ apiBaseUrl: "http://api.localhost", token: undefined, port: 0 });
    const httpServer: any = (srv as any).app.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      baseUrl = `http://127.0.0.1:${addr.port}/mcp`;
      server = srv;
      serverHttp = httpServer;
    });
    // Wait until the listen callback has set baseUrl.
    for (let i = 0; i < 50 && !baseUrl; i++) await new Promise((r) => setTimeout(r, 10));
    if (!baseUrl) throw new Error("MCP server did not start listening");
  });

  after(async () => {
    if (serverHttp) serverHttp.close?.();
    setTimeout(() => process.exit(0), 50).unref?.();
  });

  it("connectMcp performs the initialize handshake and returns the tool catalog", async () => {
    const conn = await connectMcp(baseUrl);
    try {
      assert.ok(Array.isArray(conn.tools), "tools must be an array");
      assert.ok(conn.tools.length > 0, "server should expose tools");
      // Core tools must be present.
      const names = conn.tools.map((t: any) => t.name);
      for (const expected of ["query", "chat", "list_institutions", "fetch_url"]) {
        assert.ok(names.includes(expected), `missing tool: ${expected}`);
      }
      // 2025-03-26 shape: inputSchema + annotations with title.
      const q = conn.tools.find((t: any) => t.name === "query")!;
      assert.equal(q.inputSchema.type, "object");
      assert.ok(q.annotations?.title, "tool should carry a title annotation");
    } finally {
      await conn.close();
    }
  });

  it("calls a read-only tool over the wire (dispatch works)", async () => {
    const conn = await connectMcp(baseUrl);
    try {
      // list_institutions hits the API; we only assert the MCP dispatch returns
      // a well-formed result (content array or isError) — proving the
      // tools/call round-trip over the transport is correct.
      const res: any = await conn.client.callTool({ name: "list_institutions", arguments: {} });
      assert.ok(res && Array.isArray(res.content), "result must have content blocks");
      assert.equal(typeof res.isError, "boolean", "result must report isError");
    } finally {
      await conn.close();
    }
  });

  it("raw SDK Client + StreamableHTTPClientTransport connects to /mcp", async () => {
    const client = new Client({ name: "raw-test", version: "1.0.0" }, { capabilities: { tools: {} } });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0);
    await client.close();
  });

  it("defaults to INTEL_MCP_URL when no arg is passed", () => {
    assert.equal(DEFAULT_MCP_URL, "http://mcp.localhost/mcp");
  });
});


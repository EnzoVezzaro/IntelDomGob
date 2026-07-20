// apps/cli/src/mcp-client.ts
//
// Thin MCP client for the INTEL.DOM.GOB CLI. This is the ONLY surface the CLI
// uses to talk to the platform — exactly like opencode drives its MCP tools.
// It speaks the official MCP 2025-03-26 protocol via the SDK's Client and
// connects to the INTEL.DOM.GOB MCP server (services/mcp, exposed at /mcp).
//
// No service or provider is imported here — the CLI is a pure MCP client.
// This client is intentionally standard: any MCP 2025-03-26 compliant server
// works, not just ours.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export const DEFAULT_MCP_URL =
  process.env.INTEL_MCP_URL || "http://mcp.localhost/mcp";

export interface ConnectedClient {
  client: Client;
  tools: any[];
  close: () => Promise<void>;
  url?: string;
}

/**
 * Candidate MCP endpoints to try, in order. The explicit URL (or the Docker
 * default `mcp.localhost`) is always first; the plain `:4100` variants are
 * fallbacks for bare-dev machines where Caddy/`mcp.localhost` DNS isn't set
 * up (Caddy otherwise 308-redirects to HTTPS with a self-signed cert that
 * Node's fetch rejects).
 */
function candidateUrls(primary: string): string[] {
  const out = [primary];
  try {
    const u = new URL(primary);
    // Caddy serves mcp.localhost only over HTTPS with a self-signed cert that
    // Node's fetch rejects ("unable to get local issuer certificate"). Bare-dev
    // machines run the MCP server directly on :4100 over plain HTTP, so prefer
    // those localhost endpoints over following the broken HTTPS redirect.
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      out.push(`http://localhost:${u.port || 4100}/mcp`);
      out.push(`http://127.0.0.1:${u.port || 4100}/mcp`);
    }
  } catch {
    out.push("http://localhost:4100/mcp", "http://127.0.0.1:4100/mcp");
  }
  return Array.from(new Set(out));
}

/**
 * Connect to the INTEL.DOM.GOB MCP server.
 *
 * Tries the modern Streamable HTTP transport first (2025-03-26); falls back to
 * the legacy SSE transport per endpoint. Iterates over candidate endpoints
 * (explicit URL first, then localhost fallbacks) and returns on the first
 * successful connection, plus the tool catalog.
 */
export async function connectMcp(url: string = DEFAULT_MCP_URL): Promise<ConnectedClient> {
  let lastErr: unknown = null;
  for (const endpointUrl of candidateUrls(url)) {
    const endpoint = new URL(endpointUrl);
    const client = new Client(
      { name: "intel-dom-gob-cli", version: "1.0.0" },
      {},
    );
    try {
      try {
        const transport = new StreamableHTTPClientTransport(endpoint);
        await client.connect(transport);
      } catch (e: any) {
        // Fallback to legacy SSE transport (opencode `--transport sse` style).
        const sse = new SSEClientTransport(endpoint);
        await client.connect(sse);
      }
      const { tools } = await client.listTools();
      return {
        client,
        tools,
        close: () => client.close(),
        url: endpointUrl,
      } as ConnectedClient & { url: string };
    } catch (e: any) {
      lastErr = e;
      // Try the next candidate endpoint.
    }
  }
  throw lastErr ?? new Error("No MCP endpoint could be reached");
}

/** Call an MCP tool by name with the given arguments. Returns the raw result. */
export async function callTool(
  conn: ConnectedClient,
  name: string,
  args: Record<string, unknown>,
): Promise<any> {
  return conn.client.callTool({ name, arguments: args });
}

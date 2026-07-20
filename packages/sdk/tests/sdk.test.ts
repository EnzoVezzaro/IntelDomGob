// packages/sdk/tests/sdk.test.ts
//
// Unit tests for the INTEL.DOM.GOB SDK client. These run with NO
// network: a mock `fetchImpl` is injected so every assertion exercises the
// client's real logic (URL building, auth headers, error handling,
// SSE streaming) without touching the API. The same client is what the
// CLI, MCP server and Web client use, so a green run here proves
// those consumers' contract is intact.

import { test } from "node:test";
import assert from "node:assert";
import { IntelDomGobClient, createClient } from "../src/index";

/** Build a mock fetch that records the last call and returns a canned Response. */
function mockFetch(handler: (url: string, init: any) => Response) {
  const calls: { url: string; init: any }[] = [];
  const fetchImpl = (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(handler(String(url), init));
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as Response;
}

// ── Construction & URL building ──────────────────────────────────────────

test("createClient strips trailing slash and applies v1 default", () => {
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ status: "ok" }));
  const c = createClient({ baseUrl: "http://api.localhost/", fetchImpl });
  return (c as any).health().then(() => {
    assert.ok(calls[0].url.endsWith("/v1/health"));
  });
});

test("baseUrl trailing slash is normalized", () => {
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ status: "ok" }));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost//", token: "t", fetchImpl });
  return (c as any).health().then(() => {
    // No double slash between host and /v1.
    assert.ok(!calls[0].url.includes("//v1"), `unexpected url: ${calls[0].url}`);
    assert.ok(calls[0].url === "http://api.localhost/v1/health");
  });
});

test("custom version prefix is honored", () => {
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ status: "ok" }));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", version: "v2", fetchImpl });
  return (c as any).health().then(() => {
    assert.ok(calls[0].url === "http://api.localhost/v2/health");
  });
});

// ── Auth header injection ────────────────────────────────────────────────

test("Bearer token is attached when provided", () => {
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ status: "ok" }));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", token: "secret", fetchImpl });
  return (c as any).health().then(() => {
    assert.equal(calls[0].init.headers["Authorization"], "Bearer secret");
  });
});

test("no Authorization header when token omitted", () => {
  const { fetchImpl, calls } = mockFetch(() => jsonResponse({ status: "ok" }));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  return (c as any).health().then(() => {
    assert.equal(calls[0].init.headers["Authorization"], undefined);
  });
});

// ── Error handling (requireOk) ───────────────────────────────────────

test("non-OK JSON response throws with server message", async () => {
  const { fetchImpl } = mockFetch(() =>
    jsonResponse({ error: "boom", message: "exploded" }, 500),
  );
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  await assert.rejects(
    () => (c as any).query({ query: "x" }),
    /exploded/,
  );
});

test("non-OK response with only error field is surfaced", async () => {
  const { fetchImpl } = mockFetch(() =>
    jsonResponse({ error: "nope" }, 403),
  );
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  await assert.rejects(
    () => (c as any).chat({ message: "x", context: {} }),
    /nope/,
  );
});

// ── listInstitutions payload guard ──────────────────────────────────────

test("listInstitutions returns array on well-formed payload", async () => {
  const { fetchImpl } = mockFetch(() =>
    jsonResponse({ institutions: [{ id: "senate", name: "Senado" }] }),
  );
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  const out = await c.listInstitutions();
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "senate");
});

test("listInstitutions returns [] on malformed payload (never throws)", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse({ weird: true }));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  const out = await c.listInstitutions();
  assert.deepEqual(out, []);
});

// ── fetchUrl null-on-soft-failure ──────────────────────────────────

test("fetchUrl returns null on 404", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse({ error: "nf" }, 404));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  const out = await c.fetchUrl("http://x.test/p");
  assert.equal(out, null);
});

test("fetchUrl returns null on 502", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse({ error: "bad" }, 502));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  const out = await c.fetchUrl("http://x.test/p");
  assert.equal(out, null);
});

test("fetchUrl throws on other errors (e.g. 500)", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse({ error: "boom" }, 500));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  await assert.rejects(() => c.fetchUrl("http://x.test/p"), /fetchUrl failed/);
});

// ── SSE streaming (queryStream) ──────────────────────────────────────

function sseResponse(chunks: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const ch of chunks) controller.enqueue(enc.encode(ch));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 }) as Response;
}

test("queryStream parses multiple SSE events and ignores keep-alives", async () => {
  const body =
    ": keep-alive\n\n" +
    "event: search\ndata: {\"query\":\"p\"}\n\n" +
    "event: result\ndata: {\"type\":\"result\",\"answer\":\"ok\"}\n\n";
  const { fetchImpl } = mockFetch(() => sseResponse(body));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  const events: any[] = [];
  await c.queryStream({ query: "p" }, (e) => events.push(e));
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "search");
  assert.equal(events[0].query, "p");
  assert.equal(events[1].type, "result");
  assert.equal(events[1].answer, "ok");
});

test("queryStream tolerates unparseable data lines (raw fallback)", async () => {
  const body = "event: weird\ndata: not-json\n\n";
  const { fetchImpl } = mockFetch(() => sseResponse(body));
  const c = new IntelDomGobClient({ baseUrl: "http://api.localhost", fetchImpl });
  const events: any[] = [];
  await c.queryStream({ query: "p" }, (e) => events.push(e));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "weird");
  assert.match(events[0].raw, /not-json/);
});

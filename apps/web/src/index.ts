// apps/web — public site + live demo for INTEL.DOM.GOB.
// Server-rendered marketing site (SDK only) with an interactive demo that
// calls the platform's intelligence query and renders real official sources.

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type IntelDomGobClient } from "@intel.dom.gob/sdk";
import type { IntelligenceResult } from "@intel.dom.gob/sdk/types";
import { createLogger } from "@intel.dom.gob/logger";
import { home, resultsView, type DemoPayload } from "./views.js";

const log = createLogger("app:web");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client: IntelDomGobClient = createClient({
  baseUrl: process.env.INTEL_API_URL || "http://api:4000",
});

// Cached institution count for the live "X fuentes conectadas" line.
let liveInstCount = 0;
async function refreshInstitutions(): Promise<void> {
  try {
    const list = await client.listInstitutions();
    liveInstCount = Array.isArray(list) ? list.length : 0;
  } catch {
    liveInstCount = 0;
  }
}
refreshInstitutions();
setInterval(refreshInstitutions, 5 * 60 * 1000);

function instLabel(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(instLabel).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (o.name || o.label || o.title || o.id) as string | undefined;
  }
  return undefined;
}

const CONF_ES: Record<string, string> = { high: "Alto", medium: "Medio", low: "Bajo" };

function buildPayload(query: string, r: IntelligenceResult): DemoPayload {
  const streams = [
    r.sources?.congress,
    (r.sources as unknown as Record<string, unknown>)?.camaraIniciativas,
    (r.sources as unknown as Record<string, unknown>)?.senadoIniciativas,
  ].filter(Array.isArray) as { title?: string; url: string }[][];
  const seen = new Set<string>();
  const sources: { title?: string; url: string }[] = [];
  for (const stream of streams) {
    for (const s of stream) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push({ title: s.title, url: s.url });
      if (sources.length >= 8) break;
    }
    if (sources.length >= 8) break;
  }
  const conf = String(r.response?.confidenceLevel ?? "").toLowerCase();
  return {
    ok: true,
    query,
    summary: r.response?.summary ?? "",
    confidence: CONF_ES[conf] ?? r.response?.confidenceLevel ?? "—",
    institution: instLabel((r as unknown as Record<string, unknown>).institution),
    sources,
  };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/", (_req, res) => {
  res.type("html").send(home(liveInstCount));
});

// Interactive demo endpoint (called from app.js).
app.post("/api/query", async (req, res) => {
  const q = String((req.body as { q?: unknown })?.q ?? "").trim();
  if (!q) {
    res.json({ ok: false, error: "Escribe una consulta." } satisfies DemoPayload);
    return;
  }
  try {
    const r = await client.query({ query: q });
    res.json(buildPayload(q, r));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error desconocido.";
    res.json({ ok: false, query: q, error: msg } satisfies DemoPayload);
  }
});

// No-JS / shareable results page.
app.get("/buscar", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.redirect("/#demo");
    return;
  }
  try {
    const r = await client.query({ query: q });
    res.type("html").send(resultsView(buildPayload(q, r)));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error desconocido.";
    res.type("html").send(resultsView({ ok: false, query: q, error: msg }));
  }
});

const port = Number(process.env.WEB_PORT ?? 4200);
app.listen(port, "0.0.0.0", () => {
  log.info("Public site listening", { port, api: process.env.INTEL_API_URL || "http://api:4000" });
});

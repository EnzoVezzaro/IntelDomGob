// apps/admin — production server.
//
// Serves the built Vite SPA (dist/) and proxies /api/* to the platform API
// gateway. Keeping the API under the same origin avoids CORS and keeps the
// admin token first-party. The Admin app is a pure client of the API (it only
// ever calls /v1/admin endpoints via its internal client — never the public
// @intel.dom.gob/sdk).

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const log = (...a: unknown[]) => console.log("[admin]", ...a);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "..", "dist");
const port = Number(process.env.ADMIN_PORT ?? 4300);
const target = process.env.INTEL_API_URL || "http://api:4000";

const app = express();
app.use(express.json());

// Health (used by Docker + Caddy).
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

// Proxy /api to the real API gateway, preserving the admin bearer token.
app.use("/api", async (req, res) => {
  const upstream = target + req.originalUrl.replace(/^\/api/, "");
  try {
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? JSON.stringify(req.body) : undefined;
    const r = await fetch(upstream, {
      method: req.method,
      headers: {
        ...(req.headers.authorization ? { authorization: req.headers.authorization as string } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
    });
    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (k.toLowerCase() !== "transfer-encoding") res.setHeader(k, v);
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e: any) {
    res.status(502).json({ error: "API proxy failed", message: e.message });
  }
});

// SPA fallback (serve built index.html for client routes).
app.use(express.static(dist));
app.get("*", (_req, res) => {
  const indexHtml = path.join(dist, "index.html");
  if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
  else res.type("html").send("<h1>INTEL.DOM.GOB Admin</h1><p>Build the SPA with <code>npm run build</code> first.</p>");
});

app.listen(port, "0.0.0.0", () => log(`Admin listening on :${port} (proxy → ${target})`));

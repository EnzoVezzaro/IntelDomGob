// apps/web — lightweight read-only web client of the API.
//
// Like Studio it is a pure client of the API gateway (SDK only). It renders a
// minimal server-side page listing institutions and running queries — useful as
// a no-JS fallback and as a reference for future web clients.

import express from "express";
import { IntelDomGobClient, createClient } from "@intel.dom.gob/sdk";
import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("app:web");
const client = createClient({ baseUrl: process.env.INTEL_API_URL || "http://api:4000" });

const app = express();
app.use(express.urlencoded({ extended: true }));

app.get("/", async (_req, res) => {
  try {
    const institutions = await client.listInstitutions();
    res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>INTEL.DOM.GOB — Web</title>
<style>body{font-family:system-ui;max-width:760px;margin:3rem auto;padding:0 1rem}input{width:70%;padding:.5rem}a{color:#e94e31}</style></head>
<body><h1>INTEL.DOM.GOB</h1>
<form method="get" action="/query"><input name="q" placeholder="Consulta de inteligencia..."><button>Buscar</button></form>
<h2>Instituciones</h2><ul>${institutions.map((i) => `<li><a href="${i.url}">${i.name}</a></li>`).join("")}</ul>
</body></html>`);
  } catch (e: any) {
    res.type("html").send(`<h1>Error</h1><p>${e.message}</p>`);
  }
});

app.get("/query", async (req, res) => {
  const q = String(req.query.q || "");
  try {
    const r = await client.query({ query: q });
    res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${q}</title>
<style>body{font-family:system-ui;max-width:760px;margin:3rem auto;padding:0 1rem}a{color:#e94e31}</style></head>
<body><h1>${q}</h1><p>${r.response.summary}</p>
<h2>Congreso</h2><ul>${r.sources.congress.slice(0, 8).map((s) => `<li><a href="${s.url}">${s.title}</a></li>`).join("")}</ul>
<p>Confianza: ${r.response.confidenceLevel}</p></body></html>`);
  } catch (e: any) {
    res.type("html").send(`<h1>Error</h1><p>${e.message}</p>`);
  }
});

const port = Number(process.env.WEB_PORT ?? 4200);
app.listen(port, "0.0.0.0", () => log.info("Web client listening", { port }));

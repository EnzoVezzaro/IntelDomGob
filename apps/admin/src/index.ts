// apps/admin — minimal operator/admin console for the platform.
//
// Pure client of the API (SDK only). Shows platform health and the registered
// institution registry. Extend with API-key management (via services/auth) and
// provider toggles as the platform matures.

import express from "express";
import { IntelDomGobClient, createClient } from "@intel.dom.gob/sdk";
import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("app:admin");
const client = createClient({ baseUrl: process.env.INTEL_API_URL || "http://api:4000", token: process.env.INTEL_API_TOKEN });

const app = express();

app.get("/", async (_req, res) => {
  try {
    const [health, institutions] = await Promise.all([client.health(), client.listInstitutions()]);
    res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>INTEL.DOM.GOB — Admin</title>
<style>body{font-family:system-ui;max-width:760px;margin:3rem auto;padding:0 1rem}.ok{color:green}.bad{color:red}</style></head>
<body><h1>Admin</h1>
<p>API: <span class="${health.status === "ok" ? "ok" : "bad"}">${health.status}</span> (${health.timestamp})</p>
<h2>Instituciones registradas</h2>
<table border="1" cellpadding="6"><tr><th>ID</th><th>Nombre</th><th>Legislativo</th></tr>
${institutions.map((i) => `<tr><td>${i.id}</td><td>${i.name}</td><td>${i.hasLegislative ? "sí" : "no"}</td></tr>`).join("")}
</table></body></html>`);
  } catch (e: any) {
    res.type("html").send(`<h1>Error</h1><p>${e.message}</p>`);
  }
});

const port = Number(process.env.ADMIN_PORT ?? 4300);
app.listen(port, "0.0.0.0", () => log.info("Admin client listening", { port }));

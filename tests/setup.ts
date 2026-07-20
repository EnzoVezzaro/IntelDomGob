// Load .env into process.env for the test process (dependency-free).
//
// The app reads configuration from process.env at runtime; in production the
// start script loads .env, but vitest does not populate process.env from .env
// automatically. This setup makes the REAL .env values available to tests
// (e.g. DEFAULT_AI_API_KEY, which the /query handler requires) instead of
// hardcoding fake values inside test files. Existing process.env values win so
// CI-provided vars are never clobbered.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const txt = readFileSync(envPath, "utf8");
  for (const raw of txt.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

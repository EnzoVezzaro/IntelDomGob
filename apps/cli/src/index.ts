// apps/cli — command-line client for INTEL.DOM.GOB.
//
// The CLI is just another client of the API: it talks ONLY through the SDK.
// Usage:
//   intel query "reforma tributaria"
//   intel chat --context-file result.json "¿Qué diputados impulsaron esto?"
//   intel institutions
// Env:
//   INTEL_API_URL  (default http://api.localhost)
//   INTEL_API_TOKEN (optional bearer token)

import { IntelDomGobClient, createClient } from "@intel.dom.gob/sdk";

const BASE = process.env.INTEL_API_URL || "http://api.localhost";
const TOKEN = process.env.INTEL_API_TOKEN;

const client: IntelDomGobClient = createClient({ baseUrl: BASE, token: TOKEN });

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    console.log("Commands: query <text> | chat <text> | institutions");
    process.exit(1);
  }
  if (command === "query") {
    const query = rest.join(" ");
    if (!query) {
      console.error("usage: intel query <text>");
      process.exit(1);
    }
    const result = await client.query({ query });
    console.log("\n== RESUMEN ==");
    console.log(result.response.summary);
    console.log("\n== FUENTES (Congreso) ==");
    for (const s of result.sources.congress.slice(0, 8)) console.log(`- ${s.title}\n  ${s.url}`);
    console.log(`\nConfianza: ${result.response.confidenceLevel}`);
  } else if (command === "chat") {
    const fileIdx = rest.indexOf("--context-file");
    let context: any = {};
    if (fileIdx !== -1) {
      const file = rest[fileIdx + 1];
      context = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(file, "utf-8")));
    }
    const message = rest.filter((_, i) => i !== fileIdx && i !== fileIdx + 1).join(" ");
    const { reply } = await client.chat({ message, context });
    console.log(reply);
  } else if (command === "institutions") {
    const list = await client.listInstitutions();
    for (const i of list) console.log(`- ${i.id}: ${i.name}`);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

// apps/cli — interactive terminal client for INTEL.DOM.GOB.
//
// An opencode-style terminal: a branded banner, a prompt loop, and a command
// menu — but the ONLY thing it talks to is the INTEL.DOM.GOB MCP server. Every
// capability (multi-agent query, chat, institution search, legislative SIL
// tools, web fetch) is driven through our MCP tools. No custom intelligence
// logic lives here; branding is the only customization.
//
// Connection: MCP server at INTEL_MCP_URL (default http://mcp.localhost/mcp).
// Usage: intel                 → interactive terminal
//        intel -p "question"   → one-shot, print result and exit (opencode -p)
//        intel --url URL       → connect to a specific MCP endpoint

import * as p from "@clack/prompts";
import pc from "picocolors";
import readline from "node:readline";
import { connectMcp, callTool, DEFAULT_MCP_URL, type ConnectedClient } from "./mcp-client.js";
import { interpretResult, llmRewrite } from "./interpreter.js";

// ── Branding ────────────────────────────────────────────────────────────────
// Change these to rebrand. Everything user-facing derives from here.
const BRAND = "INTEL.DOM.GOB";
const TAGLINE = "Inteligencia del Estado Dominicano";
const ACCENT = pc.cyan;
const PROMPT_LABEL = ACCENT("intel") + pc.dim(" ›");
const HELP = [
  `${pc.bold("Texto libre:")} se envía a la herramienta 'query' (agente multi-paso).`,
  `${pc.bold("Comandos:")} ${pc.dim("/query")} ${pc.dim("/chat")} ${pc.dim("/fetch")} ${pc.dim("/institutions")} ${pc.dim("/tools")} ${pc.dim("/help")} ${pc.dim("/exit")}`,
];

// ── Optional OpenAI-compatible model (for rewriting MCP results into prose) ──
// The CLI is a PURE MCP client; the server does the intelligence work. When an
// OpenAI-compatible endpoint is configured, the CLI asks it to rewrite the
// structured MCP result into a fluent brief (falls back to deterministic
// rendering when unset). Config via env, --llm-* flags, or an interactive
// prompt at startup when missing.
const LLM = {
  baseUrl: process.env.INTEL_LLM_BASE_URL ?? "",
  apiKey: process.env.INTEL_LLM_API_KEY ?? "",
  model: process.env.INTEL_LLM_MODEL ?? "",
};

// Known OpenAI-compatible providers → default base URL.
const KNOWN_PROVIDERS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  ollama: "http://localhost:11434/v1",
  together: "https://api.together.xyz/v1",
  deepseek: "https://api.deepseek.com/v1",
};

/** Fetch the model list from an OpenAI-compatible /models endpoint. */
async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const ids: string[] = (data?.data ?? [])
      .map((m: any) => m.id ?? m.name)
      .filter((x: any): x is string => typeof x === "string");
    return Array.from(new Set(ids)).sort();
  } catch {
    return [];
  }
}

/**
 * If the OpenAI-compatible model isn't fully configured, run a guided setup
 * up front (interactive terminals only). The CLI stays a pure MCP client —
 * this model is used ONLY to turn the server's structured result into prose.
 *
 * Flow: select provider (auto base URL) → custom provider asks for URL →
 * enter API key → load models from the provider (filterable, with a free-text
 * custom-model option) → select model → start chatting.
 */
async function ensureLlmConfig() {
  if (LLM.baseUrl && LLM.apiKey && LLM.model) return; // already set
  if (!INTERACTIVE) return; // never prompt in non-TTY / scripts

  // 1) Provider selection (auto base URL, plus a custom option).
  const providerOptions = [
    ...Object.entries(KNOWN_PROVIDERS).map(([id, url]) => ({
      value: id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      hint: url,
    })),
    { value: "__custom__", label: "Proveedor personalizado", hint: "introduce tu propio endpoint" },
    { value: "__skip__", label: "Omitir (mostrar resumen estructurado)" },
  ];
  const provider = await p.select({
    message: "Selecciona el proveedor de modelo",
    options: providerOptions,
  });
  if (p.isCancel(provider) || provider === "__skip__") return;

  let baseUrl: string;
  if (provider === "__custom__") {
    const customUrl = await p.text({
      message: "URL base del endpoint OpenAI-compatible",
      placeholder: "https://api.tu-proveedor.com/v1",
      validate: (v) => (v.trim() ? undefined : "La URL es requerida"),
    });
    if (p.isCancel(customUrl) || !customUrl.trim()) return;
    baseUrl = customUrl.trim().replace(/\/+$/, "");
  } else {
    baseUrl = KNOWN_PROVIDERS[provider as string];
  }
  LLM.baseUrl = baseUrl;

  // 2) API key.
  const apiKey = await p.password({
    message: "API key del proveedor",
    mask: "*",
  });
  if (p.isCancel(apiKey) || !String(apiKey).trim()) {
    LLM.baseUrl = "";
    return;
  }
  LLM.apiKey = String(apiKey).trim();

  // 3) Model selection: load models from the provider, filterable, with a
  //    "(custom name)" option that prompts for the exact model id.
  const spin = p.spinner();
  spin.start("Cargando modelos del proveedor…");
  const models = await fetchModels(baseUrl, LLM.apiKey);
  spin.stop(models.length ? `${models.length} modelos disponibles.` : "No se pudieron listar modelos.");

  const CUSTOM = "__custom_model__";
  const baseOptions = models.map((id) => ({ value: id, label: id }));
  const options = [
    ...baseOptions,
    { value: CUSTOM, label: "(usar nombre de modelo personalizado)" },
  ];

  const modelChoice = await p.autocomplete({
    message: "Selecciona el modelo (o filtra y elige el personalizado)",
    options,
    placeholder: "Escribe para filtrar…",
    maxItems: 12,
  });
  if (p.isCancel(modelChoice)) {
    LLM.baseUrl = "";
    LLM.apiKey = "";
    return;
  }
  const chosen = modelChoice as string;
  if (chosen === CUSTOM) {
    const customModel = await p.text({
      message: "Nombre exacto del modelo",
      placeholder: "gpt-4o-mini",
      validate: (v) => (v.trim() ? undefined : "El nombre es requerido"),
    });
    if (p.isCancel(customModel) || !customModel.trim()) {
      LLM.baseUrl = "";
      LLM.apiKey = "";
      return;
    }
    LLM.model = customModel.trim();
  } else {
    LLM.model = chosen;
  }
  p.log.success(`Intérprete listo (${LLM.model} @ ${baseUrl}).`);
}

const INTERACTIVE = !!process.stdin.isTTY;

// ── Rendering ─────────────────────────────────────────────────────────────────
function banner() {
  if (INTERACTIVE) {
    p.intro(`${ACCENT(BRAND)} ${pc.dim("· " + TAGLINE)}`);
    p.note(HELP.join("\n"), "Bienvenido");
    return;
  }
  console.log("");
  console.log(`${ACCENT(BRAND)} · ${TAGLINE}`);
  console.log(HELP.join("\n"));
  console.log("");
}

function renderAnswer(answer: ReturnType<typeof interpretResult>) {
  const parts: string[] = [];
  parts.push(pc.bold(answer.title));
  parts.push("");
  parts.push(answer.summary);
  if (answer.body) {
    parts.push("");
    parts.push(answer.body);
  }
  if (answer.confidence) {
    parts.push("");
    parts.push(`${pc.dim("Confianza:")} ${answer.confidence}`);
  }
  if (answer.citations.length) {
    parts.push("");
    parts.push(pc.dim(`Fuentes (${answer.citations.length}):`));
    for (const c of answer.citations) {
      parts.push(`  ${pc.cyan("›")} ${c.title}`);
      parts.push(`    ${pc.dim(c.url)}`);
    }
  }
  const text = parts.join("\n");
  if (INTERACTIVE) p.outro(text);
  else console.log(text);
}

/** Render a raw MCP result; interpret query/chat into prose, dump others. */
async function renderResult(result: any, name?: string) {
  if (!result) {
    if (INTERACTIVE) p.log.warn("Sin respuesta.");
    else console.log("(sin respuesta)");
    return;
  }
  if (result.isError) {
    const text = Array.isArray(result.content)
      ? result.content.map((c: any) => c.text ?? "").join("\n")
      : JSON.stringify(result, null, 2);
    if (INTERACTIVE) p.log.error(text);
    else {
      console.log(pc.red("Error:"));
      console.log(text);
    }
    return;
  }
  const interpretable = name === "query" || name === "chat";
  if (interpretable) {
    let answer = interpretResult(result);
    // Optional LLM rewrite into fluent prose (OpenAI-compatible). Falls back
    // to the deterministic render if the model is unset or the call fails.
    const rewritten = await llmRewrite(result, LLM);
    if (rewritten) {
      answer = { ...answer, summary: rewritten, body: "" };
    }
    renderAnswer(answer);
    return;
  }
  // Non-interpretable tools: pretty-print the JSON, not a raw dump.
  const text = Array.isArray(result.content)
    ? result.content.map((c: any) => c.text ?? "").join("\n")
    : JSON.stringify(result, null, 2);
  if (INTERACTIVE) p.outro(text);
  else console.log(text);
}

async function runToolFlow(conn: ConnectedClient, name: string, args: Record<string, unknown>) {
  const spin = INTERACTIVE ? p.spinner() : null;
  spin?.start(`Ejecutando ${ACCENT(name)}…`);
  if (!INTERACTIVE) console.log(`Ejecutando ${name}…`);
  try {
    const result = await callTool(conn, name, args);
    spin?.stop(`${ACCENT(name)} completado.`);
    await renderResult(result, name);
  } catch (e: any) {
    spin?.stop(`${name} falló.`);
    if (INTERACTIVE) p.log.error(e?.message ?? String(e));
    else console.log(pc.red(`Error: ${e?.message ?? String(e)}`));
  }
}

// ── Argument prompting ─────────────────────────────────────────────────────────
/** Pick a tool from the catalog and prompt for its arguments, then invoke it. */
async function toolsMenu(conn: ConnectedClient) {
  if (conn.tools.length === 0) {
    if (INTERACTIVE) p.log.warn("No hay herramientas disponibles en el servidor MCP.");
    else console.log(pc.yellow("No hay herramientas disponibles en el servidor MCP."));
    return;
  }
  const choice = await selectTool(conn.tools.map((t: any) => t.name));
  if (choice == null) return;

  const tool = conn.tools.find((t: any) => t.name === choice)!;
  const props: Record<string, any> = tool.inputSchema?.properties ?? {};
  const required: string[] = tool.inputSchema?.required ?? [];
  const args: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(propertiesOf(props))) {
    const isReq = required.includes(key);
    const val = await promptLine(`${key}${isReq ? " *" : ""} (${schemaType(schema)})`, schema?.description);
    if (val == null) return;
    if (val === "" && !isReq) continue;
    args[key] = coerce(schema, val);
  }
  await runToolFlow(conn, choice, args);
}

function propertiesOf(p: Record<string, any>): Record<string, any> {
  return p ?? {};
}
function schemaType(s: any): string {
  return s?.type === "number" ? "number" : s?.type === "array" ? "array" : "text";
}
function coerce(schema: any, val: string): unknown {
  if (schema?.type === "number") return Number(val);
  if (schema?.type === "array") {
    try {
      return JSON.parse(val);
    } catch {
      return val.split(",").map((s) => s.trim());
    }
  }
  return val;
}

// ── I/O abstraction (TTY vs piped) ──────────────────────────────────────────────
let nonTtyRl: readline.Interface | null = null;
function getNonTtyRl(): readline.Interface {
  if (!nonTtyRl) {
    nonTtyRl = readline.createInterface({ input: process.stdin, terminal: false });
  }
  return nonTtyRl;
}
function nonTtyAsk(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = getNonTtyRl();
    process.stdout.write(`${pc.cyan("›")} ${question}\n`);
    rl.once("line", (line: string) => resolve(line.trim()));
    rl.once("close", () => resolve(null));
  });
}

/**
 * Prompt for a line of text. Uses clack's styled prompt in an interactive
 * terminal (opencode-style UX); falls back to a plain readline prompt when
 * stdin is piped (automation/scripts) so the CLI never hangs on a TTY-only API.
 * Returns null on cancel / EOF.
 */
async function promptLine(message: string, _placeholder?: string): Promise<string | null> {
  if (INTERACTIVE) {
    const val = await p.text({ message, placeholder: _placeholder });
    if (p.isCancel(val)) return null;
    return val as string;
  }
  return nonTtyAsk(`${message}:`);
}

/** Pick one item from a list. clack select in a TTY, numbered list otherwise. */
async function selectTool(options: string[]): Promise<string | null> {
  if (INTERACTIVE) {
    const choice = await p.select({
      message: "Selecciona una herramienta MCP",
      options: options.map((name) => ({ value: name, label: name })),
    });
    if (p.isCancel(choice)) return null;
    return choice as string;
  }
  options.forEach((o, i) => console.log(`  ${pc.cyan(String(i + 1))}. ${o}`));
  const n = await nonTtyAsk("número de herramienta:");
  const idx = n == null ? -1 : Number(n);
  return idx >= 1 && idx <= options.length ? options[idx - 1] : null;
}

// ── Main loop ───────────────────────────────────────────────────────────────────
async function loop(conn: ConnectedClient) {
  while (true) {
    const input = await promptLine("Pregunta o comando", "Ej: reforma del código penal · /tools · /help");
    if (input == null) break;
    const text = input.trim();
    if (!text) continue;

    if (text === "/exit" || text === "/quit") break;
    if (text === "/help") {
      banner();
      continue;
    }
    if (text === "/tools") {
      await toolsMenu(conn);
      continue;
    }
    if (text === "/institutions") {
      await runToolFlow(conn, "list_institutions", {});
      continue;
    }

    const [cmd, ...rest] = text.split(/\s+/);
    const argStr = rest.join(" ");

    if (cmd === "/query") {
      await runToolFlow(conn, "query", { query: argStr });
      continue;
    }
    if (cmd === "/chat") {
      await runToolFlow(conn, "chat", { message: argStr, context: {} });
      continue;
    }
    if (cmd === "/fetch") {
      const url = argStr;
      if (!/^https?:\/\//.test(url)) {
        if (INTERACTIVE) p.log.warn("Usa una URL http(s) completa.");
        else console.log(pc.yellow("Usa una URL http(s) completa."));
        continue;
      }
      await runToolFlow(conn, "fetch_url", { url });
      continue;
    }

    // Free-text → multi-agent intelligence query (the default opencode-style path).
    await runToolFlow(conn, "query", { query: text });
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const urlIdx = argv.indexOf("--url");
  const promptIdx = argv.indexOf("-p");
  const promptIdxLong = argv.indexOf("--prompt");
  const quiet = argv.includes("-q") || argv.includes("--quiet");
  const fmtIdx = argv.indexOf("-f");
  const format = fmtIdx !== -1 ? argv[fmtIdx + 1] : "text";
  const promptVal =
    promptIdx !== -1
      ? argv[promptIdx + 1]
      : promptIdxLong !== -1
        ? argv[promptIdxLong + 1]
        : undefined;
  const url = urlIdx !== -1 ? argv[urlIdx + 1] : undefined;
  const llmBase = argValue(argv, "--llm-base");
  const llmKey = argValue(argv, "--llm-key");
  const llmModel = argValue(argv, "--llm-model");
  if (llmBase) LLM.baseUrl = llmBase;
  if (llmKey) LLM.apiKey = llmKey;
  if (llmModel) LLM.model = llmModel;
  return { url, prompt: promptVal, quiet, format };
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const { url, prompt, quiet, format } = parseArgs(process.argv.slice(2));
  const target = url ?? DEFAULT_MCP_URL;

  if (!quiet) {
    const spin = INTERACTIVE ? p.spinner() : null;
    spin?.start(`Conectando a ${ACCENT(BRAND)} MCP (${pc.dim(target)})…`);
    if (!INTERACTIVE) console.log(`Conectando a ${BRAND} MCP (${target})…`);
    let conn: ConnectedClient;
    try {
      await ensureLlmConfig();
      conn = await connectMcp(target);
      spin?.stop(`Conectado · ${conn.tools.length} herramientas MCP.`);
      if (!INTERACTIVE) console.log(`Conectado · ${conn.tools.length} herramientas MCP (${conn.url}).`);
    } catch (e: any) {
      spin?.stop("No se pudo conectar al servidor MCP.");
      if (INTERACTIVE) {
        p.log.error(e?.message ?? String(e));
        p.log.info(`Verifica que el servidor MCP esté activo en ${target} (INTEL_MCP_URL).`);
      } else {
        console.log(pc.red(`No se pudo conectar al servidor MCP: ${e?.message ?? String(e)}`));
        console.log(`Verifica que el servidor MCP esté activo en ${target} (INTEL_MCP_URL).`);
      }
      process.exit(1);
      return;
    }

    banner();
    try {
      if (prompt != null) {
        // One-shot mode (opencode -p): run query, print, exit.
        const result = await callTool(conn, "query", { query: prompt });
        if (format === "json") {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.isError) {
          console.log(pc.red(Array.isArray(result.content) ? result.content.map((c: any) => c.text ?? "").join("\n") : JSON.stringify(result)));
          process.exitCode = 1;
        } else {
          await renderResult(result, "query");
        }
      } else {
        await loop(conn);
      }
    } finally {
      await conn.close().catch(() => {});
    }
    if (!quiet && INTERACTIVE) p.outro(`Sesión ${ACCENT(BRAND)} finalizada.`);
    else if (!quiet) console.log(`Sesión ${BRAND} finalizada.`);
    process.exit(0);
  } else {
    // Quiet one-shot path: no spinner, just connect + run.
    let conn: ConnectedClient;
    try {
      conn = await connectMcp(target);
    } catch (e: any) {
      console.log(pc.red(`No se pudo conectar al servidor MCP: ${e?.message ?? String(e)}`));
      process.exit(1);
      return;
    }
    try {
      const result = await callTool(conn, "query", { query: prompt ?? "" });
      if (format === "json") console.log(JSON.stringify(result, null, 2));
      else if (result.isError) {
        console.log(Array.isArray(result.content) ? result.content.map((c: any) => c.text ?? "").join("\n") : JSON.stringify(result));
        process.exitCode = 1;
      } else {
        await renderResult(result, "query");
      }
    } finally {
      await conn.close().catch(() => {});
    }
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((e) => {
  p.log.error(e?.message ?? String(e));
  process.exit(1);
});

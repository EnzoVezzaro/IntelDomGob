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
import { connectMcp, callTool, DEFAULT_MCP_URL, type ConnectedClient, type NotificationHandler } from "./mcp-client.js";
import { interpretResult, llmRewrite } from "./interpreter.js";
import { loadConfig, saveConfig, llmConfigured, type CliConfig } from "./config.js";

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
// rendering when unset).
//
// Sourced, in priority order: --llm-* flags → env (`INTEL_LLM_*`) → the saved
// `~/.intel/config.json` file. The interactive startup prompt only fires when
// all three fields aren't already set from any source (and the terminal is a
// TTY); when it runs, the chosen values are persisted to the config file so
// the next launch skips the prompt.
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
      headers: apiKey ? { Authorization: `Bearer ${apiKey}`, "X-Intel-Client": "cli" } : { "X-Intel-Client": "cli" },
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

// ── INTEL.API key onboarding ───────────────────────────────────────────────────
// The CLI is a PURE MCP client at every step: even verifying the user's
// entered API key happens through the MCP server's `verify_key` tool, which
// forwards the request to the API via the SDK. No direct API call is ever
// made from the CLI.
//
// The verification result is cached in `~/.intel/config.json` so the resume
// can render without re-running the tool on every launch.

/** Shape returned by the MCP `verify_key` tool (mirrors the API response). */
interface KeyVerification {
  valid: boolean;
  plan: string;
  scopes: string[];
  quotaDaily: number;
  rateLimit: number;
  product: string;
  keyId: string;
  /** Present only when the MCP tool caught an API error (invalid key). */
  error?: string;
}

/**
 * Mask a key for the resume (e.g. `idg_abc…xyz`). Reveals the prefix and last
 * 3 chars so the user can confirm which key is saved without us printing it.
 */
function maskKey(k: string): string {
  if (!k) return "(ninguna · Público)";
  if (k.length <= 8) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 6)}…${k.slice(-3)}`;
}

/**
 * Ask for the INTEL.DOM.GOB API key when none is saved. Validates the entered
 * key live via the MCP `verify_key` tool and loops until either:
 *   - a valid key is entered and saved, OR
 *   - the user leaves it empty (Público plan, no key).
 *
 * `conn` is the already-connected MCP client; the verify happens through it.
 * Mutates the passed `cfg` in place and persists it to disk.
 */
async function ensureApiKey(cfg: CliConfig, conn: ConnectedClient): Promise<KeyVerification | null> {
  // An INTEL_API_KEY env override covers the "no onboarding prompt" path:
  // we still verify it through MCP once, then save it.
  const envKey = process.env.INTEL_API_KEY;
  if (envKey && !cfg.intelApiKey) cfg.intelApiKey = envKey.trim();
  if (cfg.intelApiKey && cfg.keyVerification) return cfg.keyVerification;
  if (!INTERACTIVE) return null;

  if (cfg.intelApiKey) {
    // A key is saved but we have no cached verification — re-verify silently.
    const v = await verifyViaMcp(conn, cfg.intelApiKey);
    if (v) {
      cfg.keyVerification = v;
      await saveConfig(cfg);
      return v;
    }
    // Saved key no longer valid → clear it and re-onboard.
    p.log.warn("La API key guardada ya no es válida. Vamos a reconfigurarla.");
    cfg.intelApiKey = "";
    cfg.keyVerification = undefined;
  }

  while (true) {
    const input = await p.password({
      message: "INTEL.API key (deja vacío para el Plan Público)",
      mask: "*",
    });
    if (p.isCancel(input)) {
      // Cancel = keep Público session this time, do not persist.
      return null;
    }
    const key = String(input).trim();
    if (!key) {
      // Empty = Público plan — valid choice.
      p.log.success(pc.dim("Plan Público · 20 consultas/día, sin API key."));
      cfg.intelApiKey = "";
      cfg.keyVerification = undefined;
      await saveConfig(cfg);
      return null;
    }

    const v = await verifyViaMcp(conn, key);
    if (!v) {
      // Invalid key — loop and ask again.
      continue;
    }
    cfg.intelApiKey = key;
    cfg.keyVerification = v;
    await saveConfig(cfg);
    p.log.success(`Plan ${pc.bold(v.plan)} verificado (${maskKey(key)}).`);
    return v;
  }
}

/** Verify a candidate key via the MCP `verify_key` tool; returns null on failure. */
async function verifyViaMcp(conn: ConnectedClient, key: string): Promise<KeyVerification | null> {
  const spin = p.spinner();
  spin.start("Verificando API key…");
  try {
    const res: any = await callTool(conn, "verify_key", { apiKey: key });
    // The MCP tool wraps payloads as content blocks. Extract the JSON payload.
    const payload: any = extractToolPayload(res);
    const v: KeyVerification | null = payload && typeof payload === "object" ? payload : null;
    if (!v || v.valid === false) {
      const reason = v?.error ? `: ${v.error}` : "";
      spin.stop(`La API key no es válida${reason}.`);
      return null;
    }
    spin.stop(`API key válida · Plan ${v.plan}.`);
    return v;
  } catch (e: any) {
    spin.stop("La API key no es válida.");
    p.log.warn(e?.message ?? String(e));
    return null;
  }
}

/** Walk an MCP `tools/call` result and pull the first JSON payload out of the
 *  content array (mirrors the interpreter's `extractPayload` for the verify
 *  tool specifically — kept local so the CLI stays a pure MCP client). */
function extractToolPayload(result: any): any {
  if (!result) return null;
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (typeof block?.text === "string") {
        try {
          return JSON.parse(block.text);
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

// ── Resume / pre-chat summary ──────────────────────────────────────────────────
/**
 * Print a resume of the current session settings before entering the chat
 * loop: API plan + key, LLM interpreter (if any), MCP server target.
 * Silently skipped in quiet mode (`-q`) and piped one-shot invocations.
 */
function showResume(cfg: CliConfig, mcpUrl: string, verification: KeyVerification | null) {
  const plan = verification?.plan ?? (cfg.intelApiKey ? "(sin verificar)" : "publico");
  const quota = verification?.quotaDaily != null ? `${verification.quotaDaily}/día` : null;
  const planLine = `${pc.dim("Plan:")} ${pc.bold(plan)}${quota ? ` · ${pc.dim(quota)}` : ""} · ${pc.dim("key:")} ${maskKey(cfg.intelApiKey)}`;
  const llmLine = llmConfigured(LLM)
    ? `${pc.dim("Intérprete:")} ${LLM.model} @ ${LLM.baseUrl}`
    : `${pc.dim("Intérprete:")} ${pc.italic("(deshabilitado · resumen estructurado)")}`;
  const mcpLine = `${pc.dim("Servidor MCP:")} ${mcpUrl}`;
  if (INTERACTIVE) {
    p.note([planLine, llmLine, mcpLine].join("\n"), "Configuración");
  } else {
    console.log("Configuración:");
    console.log(`  ${planLine}`);
    console.log(`  ${llmLine}`);
    console.log(`  ${mcpLine}`);
  }
}

const INTERACTIVE = !!process.stdin.isTTY;

// ── Progress sink ────────────────────────────────────────────────────────────
// The MCP notification handler is installed once at connect time, but the
// active display target (spinner vs. stdout line) changes per call. We keep a
// mutable reference here so `connectMcp`'s single callback can route each
// notification to whoever is currently registered.
type ProgressSink = (line: string) => void;
let currentProgressSink: ProgressSink | null = null;

/** Human-readable label for a `notifications/message` payload from the server. */
function progressLabel(data: unknown, meta?: Record<string, unknown>): string {
  const base = typeof data === "string" ? data : "";
  const evt = meta && typeof meta.event === "string" ? String(meta.event) : "";
  if (evt === "plan") return `Plan · ${base}`;
  if (evt === "search") return `Búsqueda · ${base}`;
  if (evt === "retrieval") return `Recuperación · ${base}`;
  if (evt === "reasoning") return `Análisis · ${base}`;
  return base || "Procesando…";
}

/** Sink passed to `connectMcp` — forwards each notification to the active one. */
const onAgentNotification: NotificationHandler = (_level, data, meta) => {
  const sink = currentProgressSink;
  if (!sink) return;
  sink(progressLabel(data, meta));
};

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
  // Route agent progress notifications to the active spinner / stdout.
  currentProgressSink = (line: string) => {
    if (spin) spin.message(`${ACCENT(name)} · ${pc.dim(line)}`);
    else console.log(`  ${pc.dim("›")} ${line}`);
  };
  try {
    const result = await callTool(conn, name, args);
    spin?.stop(`${ACCENT(name)} completado.`);
    await renderResult(result, name);
  } catch (e: any) {
    spin?.stop(`${name} falló.`);
    if (INTERACTIVE) p.log.error(e?.message ?? String(e));
    else console.log(pc.red(`Error: ${e?.message ?? String(e)}`));
  } finally {
    currentProgressSink = null;
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

  // Load saved config (~/.intel/config.json) ONCE at startup. The interactive
  // prompts below mutate `cfg` in place and persist it back, so subsequent
  // launches skip onboarding. Env vars and --llm-* flags always win over the
  // file for the LLM interpreter (so CI / scripts can override on-demand).
  const cfg = await loadConfig();
  if (!LLM.baseUrl && !LLM.apiKey && !LLM.model && llmConfigured(cfg.llm)) {
    LLM.baseUrl = cfg.llm.baseUrl;
    LLM.apiKey = cfg.llm.apiKey;
    LLM.model = cfg.llm.model;
  }

  if (!quiet) {
    banner();

    const spin = INTERACTIVE ? p.spinner() : null;
    spin?.start(`Conectando a ${ACCENT(BRAND)} MCP (${pc.dim(target)})…`);
    if (!INTERACTIVE) console.log(`Conectando a ${BRAND} MCP (${target})…`);
    let conn: ConnectedClient;
    try {
      conn = await connectMcp(target, onAgentNotification);
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

    try {
      // Onboarding (interactive only): API key first, then LLM interpreter.
      // Both are skipped silently in non-TTY / quiet / one-shot mode. The API
      // key is verified through the MCP server's `verify_key` tool — the CLI
      // never talks to the API directly.
      const verification = await ensureApiKey(cfg, conn);
      await ensureLlmConfig();
      // Persist any LLM values that just came in (env / prompt / flags).
      cfg.llm = { baseUrl: LLM.baseUrl, apiKey: LLM.apiKey, model: LLM.model };
      await saveConfig(cfg);

      // Show the resume after onboarding, right before the chat loop / one-shot.
      if (prompt == null) showResume(cfg, conn.url ?? target, verification);

      if (prompt != null) {
        // One-shot mode (opencode -p): run query, print, exit.
        const isJson = format === "json";
        const shotSpin = INTERACTIVE && !isJson ? p.spinner() : null;
        shotSpin?.start(`${ACCENT("query")} · ${pc.dim("Procesando…")}`);
        currentProgressSink = (line: string) => {
          if (shotSpin) shotSpin.message(`${ACCENT("query")} · ${pc.dim(line)}`);
          else if (!isJson) console.log(`  ${pc.dim("›")} ${line}`);
        };
        let result: any;
        try {
          result = await callTool(conn, "query", { query: prompt });
        } finally {
          currentProgressSink = null;
          shotSpin?.stop(`${ACCENT("query")} completado.`);
        }
        if (isJson) {
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
      conn = await connectMcp(target, onAgentNotification);
    } catch (e: any) {
      console.log(pc.red(`No se pudo conectar al servidor MCP: ${e?.message ?? String(e)}`));
      process.exit(1);
      return;
    }
    try {
      const isJson = format === "json";
      // In JSON mode we stay silent — progress would corrupt the JSON output.
      if (!isJson) currentProgressSink = (line: string) => console.log(`  ${pc.dim("›")} ${line}`);
      const result = await callTool(conn, "query", { query: prompt ?? "" });
      currentProgressSink = null;
      if (isJson) console.log(JSON.stringify(result, null, 2));
      else if (result.isError) {
        console.log(Array.isArray(result.content) ? result.content.map((c: any) => c.text ?? "").join("\n") : JSON.stringify(result));
        process.exitCode = 1;
      } else {
        await renderResult(result, "query");
      }
    } finally {
      currentProgressSink = null;
      await conn.close().catch(() => {});
    }
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((e) => {
  p.log.error(e?.message ?? String(e));
  process.exit(1);
});

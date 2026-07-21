// apps/cli/src/config.ts
//
// Persistent CLI configuration. Stored as JSON in the user's home directory at
// `~/.intel/config.json` (mirrors opencode's per-user config location). The
// file is private to the user (mode 0600) and NEVER committed to the repo.
//
// Holds two things:
//   1. `intelApiKey`  — the INTEL.DOM.GOB API key (optional; empty string means
//      the Público plan, no key sent to the API on requests that support the
//      preview tier).
//   2. `llm`          — the optional OpenAI-compatible "interpreter" used by
//      the CLI to rewrite structured MCP results into fluent prose. All three
//      fields blank = interpreter disabled (raw structured render).
//
// This module is the ONLY place the CLI touches the filesystem for settings.
// Everything else (MCP URL, flags, env) stays in `index.ts` / `mcp-client.ts`.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Persisted CLI configuration. */
export interface CliConfig {
  /** INTEL.DOM.GOB API key. Empty string = Público plan (no key). */
  intelApiKey: string;
  /** Last-verified tier metadata for `intelApiKey` (cached so we can show the
   *  resume without re-hitting the API on every launch). */
  keyVerification?: {
    valid: boolean;
    plan: string;
    scopes: string[];
    quotaDaily: number;
    rateLimit: number;
    product: string;
    keyId: string;
  };
  /** Optional OpenAI-compatible "interpreter" for prose rewriting. */
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

const CONFIG_DIR = path.join(os.homedir(), ".intel");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/** The default Público config (no API key, no LLM interpreter). */
export const DEFAULT_CONFIG: CliConfig = {
  intelApiKey: "",
  llm: { baseUrl: "", apiKey: "", model: "" },
};

/** True when all three LLM interpreter fields are set. */
export function llmConfigured(llm: CliConfig["llm"]): boolean {
  return !!(llm.baseUrl && llm.apiKey && llm.model);
}

/**
 * Load the CLI config. Returns the DEFAULT_CONFIG when the file is missing,
 * unreadable, or malformed — never throws. Environment overrides take effect
 * via `applyEnv()` (callers decide whether they want env to win over the file).
 */
export async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return {
      intelApiKey: typeof parsed.intelApiKey === "string" ? parsed.intelApiKey : "",
      keyVerification: parsed.keyVerification ?? undefined,
      llm: {
        baseUrl: parsed.llm?.baseUrl ?? "",
        apiKey: parsed.llm?.apiKey ?? "",
        model: parsed.llm?.model ?? "",
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist the CLI config to `~/.intel/config.json` (creates the dir; mode 0600). */
export async function saveConfig(cfg: CliConfig): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", {
      mode: 0o600,
      encoding: "utf8",
    });
  } catch {
    // A failed save is non-fatal — the in-memory config still drives the session.
  }
}

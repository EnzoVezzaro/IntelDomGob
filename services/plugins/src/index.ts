// services/plugins
//
// Lightweight plugin system. A plugin is a self-describing extension that the
// platform can discover and invoke: { id, name, version, kind, setup, invoke }.
// Plugins are registered at boot (never auto-loaded from arbitrary paths in
// production) and expose a manifest over the API so Studio can list them.
//
// `invoke` runs inside a guarded executor (timeout + try/catch) — the plugin
// boundary. No plugin code is imported by higher layers directly; everything
// goes through PluginRegistry.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:plugins");

export type PluginKind = "source" | "transform" | "exporter" | "agent";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  description?: string;
}

export interface PluginContext {
  tenantId?: string;
  config?: Record<string, unknown>;
}

export interface Plugin {
  manifest: PluginManifest;
  /** Optional one-time setup (register sub-resources). */
  setup?: () => Promise<void> | void;
  /** Invoke the plugin's capability. */
  invoke: (args: Record<string, unknown>, ctx: PluginContext) => Promise<unknown>;
}

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.manifest.id, plugin);
    log.info("plugin registered", { id: plugin.manifest.id, kind: plugin.manifest.kind });
  }

  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  list(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  /** Run a plugin inside a guarded executor (timeout + isolation of errors). */
  async run(id: string, args: Record<string, unknown>, ctx: PluginContext = {}, timeoutMs = 10_000): Promise<unknown> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Plugin ${id} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      return await Promise.race([plugin.invoke(args, ctx), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Run setup() for every registered plugin (idempotent boot step). */
  async setupAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.setup?.();
      } catch (e) {
        log.warn("plugin setup failed", { id: plugin.manifest.id, error: String(e) });
      }
    }
  }
}

/** Build a manifest-only descriptor (for API listing without exposing invoke). */
export function describePlugin(p: Plugin): PluginManifest {
  return p.manifest;
}

// services/prompts
//
// Versioned prompt templates. A prompt is stored with a key, an ordered list of
// versions (latest wins), and rendered with provided variables. Prompts are the
// single source of truth for model prompts so they can be tuned without code
// changes. Rendering is a safe `{{var}}` substitution — no code evaluation.

export interface PromptVersion {
  version: number;
  template: string;
  createdAt: string;
  note?: string;
}

export interface Prompt {
  key: string;
  description?: string;
  versions: PromptVersion[];
}

export class PromptService {
  private prompts = new Map<string, Prompt>();

  /** Register or append a new version of a prompt. Returns the new version. */
  add(key: string, template: string, opts: { description?: string; note?: string } = {}): PromptVersion {
    const existing = this.prompts.get(key);
    const version = (existing?.versions.length ?? 0) + 1;
    const pv: PromptVersion = { version, template, createdAt: new Date().toISOString(), note: opts.note };
    if (existing) {
      existing.versions.push(pv);
      if (opts.description) existing.description = opts.description;
    } else {
      this.prompts.set(key, { key, description: opts.description, versions: [pv] });
    }
    return pv;
  }

  get(key: string): Prompt | undefined {
    return this.prompts.get(key);
  }

  latest(key: string): PromptVersion | undefined {
    const p = this.prompts.get(key);
    if (!p || p.versions.length === 0) return undefined;
    return p.versions[p.versions.length - 1];
  }

  list(): Prompt[] {
    return [...this.prompts.values()];
  }

  /** Render the latest version of a prompt, substituting {{var}} tokens. */
  render(key: string, vars: Record<string, unknown> = {}): string {
    const v = this.latest(key);
    if (!v) throw new Error(`Prompt not found: ${key}`);
    return v.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
      name in vars ? String(vars[name]) : `{{${name}}}`
    );
  }

  renderVersion(key: string, version: number, vars: Record<string, unknown> = {}): string {
    const p = this.prompts.get(key);
    const v = p?.versions.find((x) => x.version === version);
    if (!v) throw new Error(`Prompt ${key}@${version} not found`);
    return v.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
      name in vars ? String(vars[name]) : `{{${name}}}`
    );
  }
}

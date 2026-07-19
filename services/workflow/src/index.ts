// services/workflow
//
// Workflow engine: executes multi-step intelligence pipelines as a DAG with
// retries, checkpoints, approvals and human-in-the-loop (HITL) pauses.
//
// A workflow is a named graph of Steps. Each Step has:
//   - id
//   - deps: ids of steps that must complete first
//   - run: async (ctx) => result  (the step implementation)
//   - retries, timeoutMs, requiresApproval
//
// Execution is topologically ordered. A step that requiresApproval pauses the
// workflow (checkpoint) and emits a `workflow.approval_requested` event; it
// resumes when approve()/deny() is called. Steps are retried with backoff.
// The engine is storage-agnostic (in-memory state by default; swap for DB).

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:workflow");

export type StepStatus = "pending" | "running" | "completed" | "failed" | "awaiting_approval" | "approved" | "denied";

export interface StepResult {
  status: StepStatus;
  output?: unknown;
  error?: string;
  attempts: number;
}

export interface WorkflowContext {
  workflowId: string;
  /** Shared scratch space passed to every step. */
  inputs: Record<string, unknown>;
  /** Per-step outputs, keyed by step id. */
  results: Record<string, StepResult>;
}

export interface StepDef {
  id: string;
  deps?: string[];
  requiresApproval?: boolean;
  retries?: number;
  timeoutMs?: number;
  run: (ctx: WorkflowContext) => Promise<unknown>;
}

export interface WorkflowDef {
  name: string;
  steps: StepDef[];
}

export type ApprovalHandler = (workflowId: string, stepId: string) => void;

export interface WorkflowState {
  workflowId: string;
  name: string;
  status: "running" | "awaiting_approval" | "completed" | "failed" | "denied";
  context: WorkflowContext;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT = 30_000;

export class WorkflowEngine {
  private states = new Map<string, WorkflowState>();
  private readonly onEvent?: (type: string, payload: unknown) => void;

  constructor(onEvent?: (type: string, payload: unknown) => void) {
    this.onEvent = onEvent;
  }

  private emit(type: string, payload: unknown) {
    this.onEvent?.(type, payload);
  }

  /** Topologically sort steps (Kahn). Throws on cycles. */
  private order(def: WorkflowDef): StepDef[] {
    const byId = new Map(def.steps.map((s) => [s.id, s]));
    const indeg = new Map(def.steps.map((s) => [s.id, s.deps?.length ?? 0]));
    const queue = def.steps.filter((s) => (s.deps?.length ?? 0) === 0).map((s) => s.id);
    const ordered: StepDef[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      ordered.push(byId.get(id)!);
      for (const s of def.steps) {
        if (s.deps?.includes(id)) {
          indeg.set(s.id, (indeg.get(s.id) ?? 1) - 1);
          if (indeg.get(s.id) === 0) queue.push(s.id);
        }
      }
    }
    if (ordered.length !== def.steps.length) throw new Error("Workflow contains a dependency cycle");
    return ordered;
  }

  async start(def: WorkflowDef, inputs: Record<string, unknown> = {}, workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`): Promise<WorkflowState> {
    const ctx: WorkflowContext = { workflowId, inputs, results: {} };
    const state: WorkflowState = {
      workflowId,
      name: def.name,
      status: "running",
      context: ctx,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.states.set(workflowId, state);
    this.emit("workflow.started", { workflowId, name: def.name });

    const ordered = this.order(def);
    for (const step of ordered) {
      if (state.status === "denied" || state.status === "failed") break;
      const result = await this.runStep(def, step, ctx, state);
      if (result.status === "awaiting_approval") {
        state.status = "awaiting_approval";
        state.updatedAt = new Date().toISOString();
        return state; // pause
      }
      if (result.status === "failed") {
        state.status = "failed";
        state.updatedAt = new Date().toISOString();
        this.emit("workflow.completed", { workflowId, status: "failed" });
        return state;
      }
    }
    state.status = "completed";
    state.updatedAt = new Date().toISOString();
    this.emit("workflow.completed", { workflowId, status: "completed" });
    return state;
  }

  private async runStep(def: WorkflowDef, step: StepDef, ctx: WorkflowContext, state: WorkflowState): Promise<StepResult> {
    const retries = step.retries ?? DEFAULT_RETRIES;
    const timeout = step.timeoutMs ?? DEFAULT_TIMEOUT;
    let attempts = 0;
    while (attempts <= retries) {
      attempts++;
      try {
        if (step.requiresApproval && !(ctx.results[step.id]?.status === "approved")) {
          ctx.results[step.id] = { status: "awaiting_approval", attempts };
          this.emit("workflow.approval_requested", { workflowId: state.workflowId, stepId: step.id, name: def.name });
          return ctx.results[step.id];
        }
        const output = await this.withTimeout(step.run(ctx), timeout);
        const res: StepResult = { status: "completed", output, attempts };
        ctx.results[step.id] = res;
        return res;
      } catch (err) {
        log.warn("Step failed", { step: step.id, attempt: attempts, error: String(err) });
        if (attempts > retries) {
          const res: StepResult = { status: "failed", error: String(err), attempts };
          ctx.results[step.id] = res;
          return res;
        }
        await new Promise((r) => setTimeout(r, 200 * attempts));
      }
    }
    const res: StepResult = { status: "failed", error: "exhausted retries", attempts };
    ctx.results[step.id] = res;
    return res;
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("step timeout")), ms);
      p.then((v) => {
        clearTimeout(t);
        resolve(v);
      }).catch((e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  /** Approve a paused step and continue execution. */
  async approve(workflowId: string, stepId: string): Promise<WorkflowState | null> {
    const state = this.states.get(workflowId);
    if (!state) return null;
    const existing = state.context.results[stepId];
    if (existing?.status !== "awaiting_approval") return state;
    state.context.results[stepId] = { status: "approved", attempts: existing.attempts };
    state.status = "running";
    state.updatedAt = new Date().toISOString();
    // Execute the approved step once to capture its output before resuming.
    const approvedStep = (state as any)._def?.steps.find((s: StepDef) => s.id === stepId) as StepDef | undefined;
    if (approvedStep) {
      try {
        const out = await approvedStep.run(state.context);
        state.context.results[stepId] = { status: "approved", output: out, attempts: existing.attempts };
      } catch (err) {
        state.context.results[stepId] = { status: "failed", error: String(err), attempts: existing.attempts };
        state.status = "failed";
        this.emit("workflow.completed", { workflowId, status: "failed" });
        return state;
      }
    }
    // Re-run remaining steps. We re-execute the full DAG from the approved step
    // forward; completed steps are skipped (their outputs persist in ctx).
    const def = (state as any)._def as WorkflowDef | undefined;
    if (def) {
      for (const step of this.order(def)) {
        const r = state.context.results[step.id];
        if (r && (r.status === "completed" || r.status === "approved")) continue;
        const result = await this.runStep(def, step, state.context, state);
        if (result.status === "awaiting_approval") {
          state.status = "awaiting_approval";
          return state;
        }
        if (result.status === "failed") {
          state.status = "failed";
          this.emit("workflow.completed", { workflowId, status: "failed" });
          return state;
        }
      }
      state.status = "completed";
      this.emit("workflow.completed", { workflowId, status: "completed" });
    }
    return state;
  }

  async deny(workflowId: string, stepId: string): Promise<WorkflowState | null> {
    const state = this.states.get(workflowId);
    if (!state) return null;
    state.context.results[stepId] = { status: "denied", attempts: state.context.results[stepId]?.attempts ?? 0 };
    state.status = "denied";
    state.updatedAt = new Date().toISOString();
    this.emit("workflow.completed", { workflowId, status: "denied" });
    return state;
  }

  getState(workflowId: string): WorkflowState | undefined {
    return this.states.get(workflowId);
  }

  /** Persist the def alongside state so approve() can resume the DAG. */
  attachDef(workflowId: string, def: WorkflowDef): void {
    (this.states.get(workflowId) as any)._def = def;
  }
}

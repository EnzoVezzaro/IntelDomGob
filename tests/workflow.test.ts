// tests/workflow.test.ts
//
// Unit + API tests for the Workflow engine: DAG ordering, retries, approval
// (human-in-the-loop) pause/resume, and denial.

import { describe, it, expect } from "vitest";
import { WorkflowEngine, type WorkflowDef } from "@intel.dom.gob/service-workflow";

describe("WorkflowEngine (unit)", () => {
  it("executes a linear DAG and accumulates step outputs", async () => {
    const events: string[] = [];
    const engine = new WorkflowEngine((t) => events.push(t));
    const def: WorkflowDef = {
      name: "research-case",
      steps: [
        { id: "search", run: async (ctx) => `results for ${ctx.inputs.q}` },
        { id: "report", deps: ["search"], run: async (ctx) => `report from ${(ctx.results.search.output as string)}` },
      ],
    };
    const state = await engine.start(def, { q: "ley 87-01" });
    expect(state.status).toBe("completed");
    expect(state.context.results.report.output).toContain("report from results for ley 87-01");
    expect(events).toContain("workflow.started");
    expect(events).toContain("workflow.completed");
  });

  it("retries a failing step up to the retry limit", async () => {
    let attempts = 0;
    const engine = new WorkflowEngine();
    const def: WorkflowDef = {
      name: "flaky",
      steps: [
        {
          id: "s",
          retries: 2,
          run: async () => {
            attempts++;
            if (attempts < 3) throw new Error("boom");
            return "ok";
          },
        },
      ],
    };
    const state = await engine.start(def);
    expect(state.status).toBe("completed");
    expect(attempts).toBe(3);
  });

  it("fails the workflow when retries are exhausted", async () => {
    const engine = new WorkflowEngine();
    const def: WorkflowDef = {
      name: "always-fails",
      steps: [{ id: "s", retries: 1, run: async () => { throw new Error("nope"); } }],
    };
    const state = await engine.start(def);
    expect(state.status).toBe("failed");
    expect(state.context.results.s.status).toBe("failed");
  });

  it("pauses for approval and resumes on approve (HITL)", async () => {
    const engine = new WorkflowEngine();
    const def: WorkflowDef = {
      name: "publish",
      steps: [
        { id: "draft", run: async () => "draft" },
        { id: "approve", deps: ["draft"], requiresApproval: true, run: async () => "approved-output" },
        { id: "publish", deps: ["approve"], run: async (ctx) => `published: ${ctx.results.approve.output}` },
      ],
    };
    const state = await engine.start(def, {});
    expect(state.status).toBe("awaiting_approval");
    expect(state.context.results.approve.status).toBe("awaiting_approval");

    engine.attachDef(state.workflowId, def);
    const resumed = await engine.approve(state.workflowId, "approve");
    expect(resumed?.status).toBe("completed");
    expect(resumed?.context.results.publish.output).toBe("published: approved-output");
  });

  it("denies a workflow at an approval gate", async () => {
    const engine = new WorkflowEngine();
    const def: WorkflowDef = {
      name: "publish",
      steps: [
        { id: "draft", run: async () => "draft" },
        { id: "approve", deps: ["draft"], requiresApproval: true, run: async () => "x" },
      ],
    };
    const state = await engine.start(def, {});
    engine.attachDef(state.workflowId, def);
    const denied = await engine.deny(state.workflowId, "approve");
    expect(denied?.status).toBe("denied");
  });

  it("detects dependency cycles", async () => {
    const engine = new WorkflowEngine();
    const def: WorkflowDef = {
      name: "cycle",
      steps: [
        { id: "a", deps: ["b"], run: async () => 1 },
        { id: "b", deps: ["a"], run: async () => 2 },
      ],
    };
    await expect(engine.start(def)).rejects.toThrow(/cycle/i);
  });
});

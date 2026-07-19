// services/scheduler
//
// Single responsibility: run recurring or deferred jobs (e.g. periodic
// institution re-indexing, usage rollups). In-process timer-based scheduler;
// swap for a distributed queue later without changing callers.

import { createLogger } from "@intel.dom.gob/logger";

const log = createLogger("service:scheduler");

export interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void> | void;
}

export class SchedulerService {
  private timers = new Map<string, NodeJS.Timeout>();

  register(job: Job): void {
    if (this.timers.has(job.name)) return;
    const tick = () => {
      Promise.resolve(job.run()).catch((e) => log.error("Job failed", { job: job.name, error: String(e) }));
    };
    tick();
    this.timers.set(job.name, setInterval(tick, job.intervalMs));
    log.info("Scheduled job", { job: job.name, intervalMs: job.intervalMs });
  }

  stop(name: string): void {
    const t = this.timers.get(name);
    if (t) clearInterval(t);
    this.timers.delete(name);
  }

  stopAll(): void {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }
}

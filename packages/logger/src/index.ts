// Centralized structured logger.
//
// Every log line includes: timestamp, service, level, requestId (when available),
// and message. Output format switches between human-friendly (development) and
// JSON (production) via the LOG_FORMAT env var.

import type { LogLevel, LogMeta } from "./types";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  format?: "development" | "production";
  requestId?: string;
}

export class Logger {
  private readonly service: string;
  private readonly level: number;
  private readonly format: "development" | "production";
  private readonly baseRequestId?: string;

  constructor(opts: LoggerOptions) {
    this.service = opts.service;
    this.level = LEVELS[opts.level ?? (isDev() ? "debug" : "info")];
    this.format = opts.format ?? (isDev() ? "development" : "production");
    this.baseRequestId = opts.requestId;
  }

  child(requestId: string): Logger {
    return new Logger({
      service: this.service,
      level: this.level as unknown as LogLevel,
      format: this.format,
      requestId,
    });
  }

  private emit(level: LogLevel, message: string, meta?: LogMeta): void {
    if (LEVELS[level] < this.level) return;
    const entry = {
      timestamp: new Date().toISOString(),
      service: this.service,
      level,
      requestId: this.baseRequestId ?? meta?.requestId,
      message,
      ...meta,
    };
    if (this.format === "production") {
      process.stdout.write(JSON.stringify(entry) + "\n");
    } else {
      const rid = entry.requestId ? ` [${entry.requestId}]` : "";
      const tag = level.toUpperCase().padEnd(5);
      const metaStr = Object.keys(meta ?? {}).length ? ` ${JSON.stringify(meta)}` : "";
      process.stderr.write(`${entry.timestamp} ${tag} (${this.service})${rid} ${message}${metaStr}\n`);
    }
  }

  debug(message: string, meta?: LogMeta): void {
    this.emit("debug", message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    this.emit("info", message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    this.emit("warn", message, meta);
  }
  error(message: string, meta?: LogMeta): void {
    this.emit("error", message, meta);
  }
}

export function createLogger(service: string, requestId?: string): Logger {
  return new Logger({ service, requestId });
}

function isDev(): boolean {
  return (process.env.NODE_ENV ?? "development") !== "production";
}

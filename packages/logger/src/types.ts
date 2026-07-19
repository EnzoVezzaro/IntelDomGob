export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMeta = Record<string, unknown> & { requestId?: string };

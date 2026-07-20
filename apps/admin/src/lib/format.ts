// Small presentation helpers shared across admin pages.

export function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const s = Math.floor(abs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const future = diff < 0;
  const suffix = future ? "from now" : "ago";
  if (s < 60) return `${s}s ${suffix}`;
  if (m < 60) return `${m}m ${suffix}`;
  if (h < 24) return `${h}h ${suffix}`;
  return `${d}d ${suffix}`;
}

export function formatDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n ?? 0);
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n ?? 0);
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n ?? 0);
}

export function formatMs(n: number): string {
  if (!n) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

export function heartRate(iso: string): "live" | "stale" | "down" {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "down";
  const diff = Date.now() - t;
  if (diff < 90_000) return "live";
  if (diff < 300_000) return "stale";
  return "down";
}

export function initials(name?: string): string {
  if (!name) return "?";
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

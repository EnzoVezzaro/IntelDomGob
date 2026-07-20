import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { PLAN_LABELS, type Plan, type PaymentStatus } from "../../lib/types";

export function PlanBadge({ plan }: { plan?: string }) {
  const key = (plan ?? "free") as Plan;
  return <Badge variant="info">{PLAN_LABELS[key] ?? plan ?? "free"}</Badge>;
}

export function PaymentBadge({ status }: { status?: string }) {
  const s = (status ?? "ok") as PaymentStatus;
  const map: Record<string, { variant: "success" | "warning" | "destructive" | "secondary"; label: string }> = {
    ok: { variant: "success", label: "OK" },
    pending: { variant: "warning", label: "Pendiente" },
    overdue: { variant: "warning", label: "Vencido" },
    suspended: { variant: "destructive", label: "Suspendido" },
  };
  const v = map[s] ?? { variant: "secondary" as const, label: s };
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

export function ActiveBadge({ active }: { active?: boolean }) {
  return active ? (
    <Badge variant="success">Activo</Badge>
  ) : (
    <Badge variant="secondary">Inactivo</Badge>
  );
}

export function ScopeBadges({ scopes }: { scopes: string[] }) {
  if (!scopes?.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <Badge key={s} variant={s === "admin" || s === "*" ? "destructive" : "outline"}>
          {s}
        </Badge>
      ))}
    </div>
  );
}

const LEVEL_VARIANT: Record<string, "default" | "secondary" | "warning" | "destructive"> = {
  debug: "secondary",
  info: "default",
  warn: "warning",
  error: "destructive",
};

export function LevelBadge({ level }: { level: string }) {
  return (
    <Badge variant={LEVEL_VARIANT[level] ?? "secondary"}>
      {level.toUpperCase()}
    </Badge>
  );
}

export function HeartBeat({ iso }: { iso: string }) {
  const t = Date.parse(iso);
  const diff = Date.now() - t;
  const live = diff < 90_000;
  const stale = diff < 300_000;
  const cls = live ? "bg-success" : stale ? "bg-warning" : "bg-destructive";
  const label = live ? "Live" : stale ? "Stale" : "Down";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("h-2 w-2 rounded-full", cls, live && "animate-pulse-dot")} />
      {label}
    </span>
  );
}

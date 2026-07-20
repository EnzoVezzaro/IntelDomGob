import { Loader2, AlertCircle, Inbox } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : "Error desconocido";
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 py-12 text-center">
      <AlertCircle className="h-6 w-6 text-destructive" />
      <div className="text-sm text-destructive">{message}</div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-14 text-center",
        className,
      )}
    >
      {icon ?? <Inbox className="h-6 w-6 text-muted-foreground" />}
      <div className="text-sm font-medium">{title}</div>
      {description && (
        <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
      )}
      {action}
    </div>
  );
}

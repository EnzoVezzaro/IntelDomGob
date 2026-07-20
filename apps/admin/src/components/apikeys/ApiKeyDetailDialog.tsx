import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, Trash2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { useApiKey, useRevokeApiKey, useActivateApiKey, useDeleteApiKey, useUpdateBilling } from "../../lib/queries";
import {
  PLANS,
  PLAN_LABELS,
  PAYMENT_STATUSES,
  type Plan,
  type PaymentStatus,
} from "../../lib/types";
import { ActiveBadge, PaymentBadge, PlanBadge, ScopeBadges } from "../common/badges";
import { formatDateTime, formatNumber } from "../../lib/format";

export function ApiKeyDetailDialog({
  id,
  open,
  onOpenChange,
}: {
  id: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: key, isLoading } = useApiKey(id ?? "");
  const revoke = useRevokeApiKey();
  const activate = useActivateApiKey();
  const del = useDeleteApiKey();
  const update = useUpdateBilling();

  const [plan, setPlan] = useState<Plan>("pro");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("ok");
  const [quotaDaily, setQuotaDaily] = useState("");
  const [rateLimit, setRateLimit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    if (key) {
      setPlan((key.plan as Plan) ?? "free");
      setPaymentStatus((key.paymentStatus as PaymentStatus) ?? "ok");
      setQuotaDaily(String(key.quotaDaily ?? 0));
      setRateLimit(String(key.rateLimit ?? 0));
      setExpiresAt(key.expiresAt ? key.expiresAt.slice(0, 16) : "");
    }
  }, [key]);

  function runRevoke() {
    if (!id) return;
    revoke.mutate(id, { onSuccess: () => toast.success("Key revocada.") });
  }
  function runActivate() {
    if (!id) return;
    activate.mutate(id, { onSuccess: () => toast.success("Key activada.") });
  }
  function runDelete() {
    if (!id) return;
    if (!confirm("¿Eliminar esta key permanentemente?")) return;
    del.mutate(id, {
      onSuccess: () => {
        toast.success("Key eliminada.");
        onOpenChange(false);
      },
    });
  }
  function saveBilling() {
    if (!id) return;
    update.mutate(
      {
        id,
        patch: {
          plan,
          paymentStatus,
          quotaDaily: Number(quotaDaily || 0),
          rateLimit: Number(rateLimit || 0),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
      },
      { onSuccess: () => toast.success("Facturación actualizada.") },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {isLoading || !key ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {key.name}
                <ActiveBadge active={key.active} />
              </DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">
                {key.id}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Producto" value={key.product ?? "—"} />
              <Field label="Uso hoy" value={`${formatNumber(key.dailyUsage ?? 0)} req`} />
              <Field label="Plan"><PlanBadge plan={key.plan} /></Field>
              <Field label="Pago"><PaymentBadge status={key.paymentStatus} /></Field>
              <div className="col-span-2">
                <div className="mb-1 text-xs text-muted-foreground">Scopes</div>
                <ScopeBadges scopes={key.scopes} />
              </div>
              <Field label="Cuota diaria" value={key.quotaDaily ? String(key.quotaDaily) : "∞"} />
              <Field label="Rate / min" value={key.rateLimit ? String(key.rateLimit) : "∞"} />
              <Field label="Tenant" value={key.tenantId ?? "—"} />
              <Field label="Org" value={key.organizationId ?? "—"} />
              <Field label="Expira" value={key.expiresAt ? formatDateTime(key.expiresAt) : "nunca"} />
              <Field label="Último nodo" value={key.lastSeenNode ?? "—"} />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="text-sm font-medium">Editar facturación / acceso</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={plan} onValueChange={(v) => setPlan(v as Plan)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLANS.map((p) => (
                        <SelectItem key={p} value={p}>{PLAN_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pago</Label>
                  <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cuota diaria</Label>
                  <Input type="number" min={0} value={quotaDaily} onChange={(e) => setQuotaDaily(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Rate / min</Label>
                  <Input type="number" min={0} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Expira</Label>
                  <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
              </div>
              <Button onClick={saveBilling} className="w-full" disabled={update.isPending}>
                <Save className="h-4 w-4" /> Guardar cambios
              </Button>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-2">
              {key.active ? (
                <Button variant="outline" onClick={runRevoke} disabled={revoke.isPending}>
                  <Ban className="h-4 w-4" /> Revocar
                </Button>
              ) : (
                <Button variant="outline" onClick={runActivate} disabled={activate.isPending}>
                  <CheckCircle2 className="h-4 w-4" /> Activar
                </Button>
              )}
              <Button variant="destructive" onClick={runDelete} disabled={del.isPending}>
                <Trash2 className="h-4 w-4" /> Eliminar
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children ?? <span className="font-mono text-xs">{value}</span>}</div>
    </div>
  );
}

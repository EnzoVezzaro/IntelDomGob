import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Checkbox } from "../ui/checkbox";
import { useCreateApiKey } from "../../lib/queries";
import {
  PLANS,
  PLAN_LABELS,
  PAYMENT_STATUSES,
  PRODUCTS,
  SCOPES,
  type Plan,
  type PaymentStatus,
  type ProductSurface,
} from "../../lib/types";

const PLAN_SCOPES: Record<Plan, string[]> = {
  free: ["read"],
  publico: ["read", "query", "chat"],
  investigador: ["read", "query", "chat"],
  pro: ["read", "query", "chat", "execute"],
  institucional: ["*"],
};

export function ApiKeyCreateDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [product, setProduct] = useState<ProductSurface>("studio");
  const [plan, setPlan] = useState<Plan>("pro");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("ok");
  const [scopes, setScopes] = useState<string[]>(PLAN_SCOPES.pro);
  const [quotaDaily, setQuotaDaily] = useState("");
  const [rateLimit, setRateLimit] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const mutation = useCreateApiKey();

  function syncScopes(p: Plan) {
    setPlan(p);
    setScopes(PLAN_SCOPES[p]);
  }
  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("El nombre es obligatorio.");
      return;
    }
    try {
      const res = await mutation.mutateAsync({
        name: name.trim(),
        product,
        plan,
        paymentStatus,
        scopes,
        quotaDaily: quotaDaily ? Number(quotaDaily) : 0,
        rateLimit: rateLimit ? Number(rateLimit) : 0,
        tenantId: tenantId || undefined,
        organizationId: organizationId || undefined,
        expiresAt: expiresAt || undefined,
      });
      setCreated({ key: res.key, name: res.record.name });
      toast.success("API key creada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la key.");
    }
  }

  function close() {
    setOpen(false);
    setTimeout(() => {
      setCreated(null);
      setName("");
      setScopes(PLAN_SCOPES.pro);
      setQuotaDaily("");
      setRateLimit("");
      setTenantId("");
      setOrganizationId("");
      setExpiresAt("");
      setCopied(false);
    }, 150);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" /> API Key creada
              </DialogTitle>
              <DialogDescription>
                Cópiala ahora. Por seguridad no se vuelve a mostrar el valor plano.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
                <code className="flex-1 break-all font-mono text-xs text-foreground">
                  {created.key}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(created.key);
                    setCopied(true);
                    toast.success("Copiada al portapapeles.");
                  }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Nombre: <span className="text-foreground">{created.name}</span>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={close}>Listo</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nueva API Key</DialogTitle>
              <DialogDescription>
                Emite una credencial para un producto/cliente de la plataforma.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre *</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Research" />
                </div>
                <div className="space-y-2">
                  <Label>Producto</Label>
                  <Select value={product} onValueChange={(v) => setProduct(v as ProductSurface)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRODUCTS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={plan} onValueChange={(v) => syncScopes(v as Plan)}>
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
              </div>

              <div className="space-y-2">
                <Label>Scopes</Label>
                <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/30 p-3">
                  {SCOPES.map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={scopes.includes(s)} onCheckedChange={() => toggleScope(s)} />
                      <span className="font-mono text-xs">{s}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="quota">Cuota diaria (0 = ∞)</Label>
                  <Input id="quota" type="number" min={0} value={quotaDaily} onChange={(e) => setQuotaDaily(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rate">Rate limit / min (0 = ∞)</Label>
                  <Input id="rate" type="number" min={0} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tenant">Tenant ID</Label>
                  <Input id="tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="opcional" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org">Org ID</Label>
                  <Input id="org" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} placeholder="opcional" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="exp">Expira (ISO, opcional)</Label>
                <Input id="exp" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={submit} disabled={mutation.isPending}>
                {mutation.isPending ? "Creando…" : "Crear key"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useApiKeys } from "../lib/queries";
import { PageHeader } from "../components/common/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "../components/common/States";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { ActiveBadge, PaymentBadge, PlanBadge, ScopeBadges } from "../components/common/badges";
import { ApiKeyCreateDialog } from "../components/apikeys/ApiKeyCreateDialog";
import { ApiKeyDetailDialog } from "../components/apikeys/ApiKeyDetailDialog";
import { PLANS, PAYMENT_STATUSES, PRODUCTS } from "../lib/types";

export function ApiKeys() {
  const [searchParams] = useSearchParams();
  const [product, setProduct] = useState<string>(searchParams.get("product") ?? "all");
  const [paymentStatus, setPaymentStatus] = useState<string>("all");
  const [active, setActive] = useState<string>("all");
  const [plan, setPlan] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useApiKeys({
    product: product === "all" ? undefined : product,
    paymentStatus: paymentStatus === "all" ? undefined : paymentStatus,
    active: active === "all" ? undefined : active === "active" ? "true" : "false",
  });

  const rows = useMemo(() => {
    let list = data?.keys ?? [];
    if (plan !== "all") list = list.filter((k) => (k.plan ?? "free") === plan);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(
        (k) =>
          k.name.toLowerCase().includes(needle) ||
          k.id.toLowerCase().includes(needle) ||
          (k.product ?? "").toLowerCase().includes(needle),
      );
    }
    return list;
  }, [data, plan, q]);

  function openDetail(id: string) {
    setSelected(id);
    setDetailOpen(true);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="API Keys"
        description="Emisión, revocación y control de facturación de las credenciales de acceso a la plataforma."
        actions={
          <ApiKeyCreateDialog
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Nueva key
              </Button>
            }
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nombre, id o producto…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={product} onValueChange={setProduct}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Producto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los productos</SelectItem>
            {PRODUCTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={plan} onValueChange={setPlan}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Plan" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los planes</SelectItem>
            {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={paymentStatus} onValueChange={setPaymentStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Pago" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cualquier pago</SelectItem>
            {PAYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activas</SelectItem>
            <SelectItem value="inactive">Inactivas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin API keys"
          description="Crea una credencial para empezar a dar acceso a un producto o cliente."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Nodo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((k) => (
                <TableRow
                  key={k.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(k.id)}
                >
                  <TableCell>
                    <div className="font-medium">{k.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{k.id}</div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{k.product ?? "—"}</Badge></TableCell>
                  <TableCell><PlanBadge plan={k.plan} /></TableCell>
                  <TableCell><PaymentBadge status={k.paymentStatus} /></TableCell>
                  <TableCell className="max-w-[220px]"><ScopeBadges scopes={k.scopes} /></TableCell>
                  <TableCell><ActiveBadge active={k.active} /></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.lastSeenNode ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ApiKeyDetailDialog id={selected} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}

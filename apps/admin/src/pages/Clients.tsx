import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users2, KeyRound, Globe, ArrowRight, Search, MonitorSmartphone, Terminal, Code2, Cpu, GitFork, HelpCircle } from "lucide-react";
import { useClients } from "../lib/queries";
import { PageHeader } from "../components/common/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "../components/common/States";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { formatNumber } from "../lib/format";

const CLIENT_TYPE: Record<string, { label: string; icon: typeof Cpu; variant: "secondary" | "outline" | "info" | "destructive" | "default" }> = {
  studio: { label: "Studio", icon: MonitorSmartphone, variant: "secondary" },
  cli: { label: "CLI", icon: Terminal, variant: "outline" },
  sdk: { label: "SDK", icon: Code2, variant: "info" },
  api: { label: "API", icon: Cpu, variant: "default" },
  custom: { label: "Custom Fork", icon: GitFork, variant: "outline" },
  unknown: { label: "Unknown", icon: HelpCircle, variant: "secondary" },
};

export function Clients() {
  const { data, isLoading, isError, error, refetch } = useClients(100);
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const clients = data?.clients ?? [];
  const totalRequests = useMemo(() => clients.reduce((s, c) => s + c.requests, 0), [clients]);
  const keyed = clients.filter((c) => c.isKey).length;
  const anonymous = clients.length - keyed;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (c) => c.id.toLowerCase().includes(needle) || (c.product ?? "").toLowerCase().includes(needle),
    );
  }, [clients, q]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Clients"
        description="Todo el tráfico atribuido a un cliente: por API key (autenticado) o por IP (anónimo). Conteo real desde Telemetry."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary"><KeyRound className="mr-1 h-3 w-3" />{keyed} con key</Badge>
            <Badge variant="outline"><Globe className="mr-1 h-3 w-3" />{anonymous} anónimos</Badge>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold tabular-nums">{formatNumber(clients.length)}</div>
            <div className="text-xs text-muted-foreground">clientes únicos</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold tabular-nums text-primary">{formatNumber(totalRequests)}</div>
            <div className="text-xs text-muted-foreground">requests totales</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-semibold tabular-nums">{clients.length ? Math.round(totalRequests / clients.length) : 0}</div>
            <div className="text-xs text-muted-foreground">requests / cliente</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="h-4 w-4 text-primary" /> Top clients
          </CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrar por id / producto…"
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState title="Sin clientes" description="Aún no hay tráfico registrado." icon={<Users2 className="h-6 w-6" />} />
          ) : (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => {
                    const t = CLIENT_TYPE[c.type ?? "unknown"] ?? CLIENT_TYPE.unknown;
                    const TypeIcon = t.icon;
                    return (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-[280px] truncate font-mono text-xs">{c.id}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={t.variant}><TypeIcon className="mr-1 h-3 w-3" />{t.label}</Badge>
                          {c.isKey ? (
                            <Badge variant="secondary"><KeyRound className="mr-1 h-3 w-3" />Key</Badge>
                          ) : (
                            <Badge variant="outline"><Globe className="mr-1 h-3 w-3" />IP</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.product ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatNumber(c.requests)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/observability/metrics?scope=client&id=${encodeURIComponent(c.id)}`)}
                        >
                          Métricas <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

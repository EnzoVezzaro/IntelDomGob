import { useNavigate } from "react-router-dom";
import { Server, Database, Boxes, Network, HardDrive, Bot, Globe, Cpu, CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { useNodes, useInfrastructure } from "../../lib/queries";
import { PageHeader } from "../../components/common/PageHeader";
import { LoadingState, ErrorState } from "../../components/common/States";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { HeartBeat } from "../../components/common/badges";
import { formatRelative } from "../../lib/format";

// Icon per backend component key. The label/role/status come from the live
// probe; only the icon is resolved client-side.
const ICONS: Record<string, typeof Database> = {
  postgres: Database,
  dragonfly: Boxes,
  caddy: Network,
  storage: HardDrive,
  searxng: Globe,
  api: Server,
  ai: Bot,
};

const STATUS_META: Record<string, { icon: typeof CircleCheck; className: string; label: string }> = {
  ok: { icon: CircleCheck, className: "text-success", label: "operational" },
  degraded: { icon: CircleAlert, className: "text-warning", label: "degraded" },
  down: { icon: CircleX, className: "text-destructive", label: "down" },
};

export function Infrastructure() {
  const { data, isLoading, isError, error, refetch } = useNodes();
  const infra = useInfrastructure();
  const navigate = useNavigate();
  const nodes = data?.nodes ?? [];
  const components = infra.data?.components ?? [];

  // Render the components exactly as reported by the live probe. The probe
  // already supplies label, role, managed and status; we only resolve the icon
  // and surface extra metadata (e.g. the AI provider's .env configuration).
  const cards = components.map((c) => ({
    ...c,
    icon: ICONS[c.key] ?? Server,
  }));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Infrastructure"
        description="Estado en vivo de la flota y la infraestructura gestionada. Cada componente es sondeado por el API."
        actions={
          <Badge variant="outline" className="gap-1">
            <Server className="h-3 w-3" /> {nodes.length} nodos
          </Badge>
        }
      />

      {infra.isLoading ? (
        <LoadingState />
      ) : infra.isError ? (
        <ErrorState error={infra.error} onRetry={() => infra.refetch()} />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((c) => {
            const Icon = c.icon;
            const st = c.status ?? "down";
            const meta = STATUS_META[st];
            const StatusIcon = meta.icon;
            const m = c.meta;
            return (
              <Card key={c.key}>
                <CardContent className="space-y-2 pt-5">
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-primary" />
                    <StatusIcon className={`h-4 w-4 ${meta.className}`} />
                  </div>
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground">{c.role}</div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <Badge variant={c.managed ? "secondary" : "info"} className="px-1.5 py-0">
                      {c.managed ? "managed" : "external"}
                    </Badge>
                    <span className={meta.className}>{meta.label}</span>
                    {c.latencyMs != null && <span className="text-muted-foreground">· {c.latencyMs}ms</span>}
                  </div>
                  {m && (
                    <div className="space-y-0.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
                      {m.provider && <div><span className="text-foreground/70">provider:</span> {m.provider}</div>}
                      {m.model && <div><span className="text-foreground/70">model:</span> {m.model}</div>}
                      {m.baseUrl && <div><span className="text-foreground/70">baseUrl:</span> {m.baseUrl}</div>}
                      <div className={m.keySet ? "text-success" : "text-destructive"}>
                        {m.keySet ? "API key configurada" : "⚠ API key NO configurada"}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" /> Nodos de la plataforma
          </CardTitle>
          <CardDescription>
            Instancias activas que emiten telemetría. Haz clic para ver sus métricas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : nodes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin nodos activos.</p>
          ) : (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Node ID</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Último heartbeat</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="font-medium">{n.service}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{n.id}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{n.host ?? "—"}</TableCell>
                      <TableCell><HeartBeat iso={n.lastHeartbeat} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(n.lastHeartbeat)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            navigate(`/observability/metrics?scope=node&id=${encodeURIComponent(n.id)}`)
                          }
                        >
                          Métricas
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

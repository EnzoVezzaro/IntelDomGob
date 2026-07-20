import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Server, Database, Boxes, Network, HardDrive, Bot, Globe, Cpu } from "lucide-react";
import { useNodes } from "../../lib/queries";
import { PageHeader } from "../../components/common/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "../../components/common/States";
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

// Expected platform fleet. Platform *services* report heartbeats as nodes;
// managed *infrastructure* (datastore, cache, proxy, storage) is derived from
// the running deployment. This gives a single pane of glass over everything
// that moves through the platform.
const INFRA = [
  { key: "postgres", label: "PostgreSQL", role: "Datastore", icon: Database, managed: true },
  { key: "dragonfly", label: "DragonflyDB", role: "Cache · Event Bus · Telemetry", icon: Boxes, managed: true },
  { key: "caddy", label: "Caddy", role: "Reverse Proxy · TLS", icon: Network, managed: true },
  { key: "storage", label: "Object Storage", role: "Documentos · artefactos", icon: HardDrive, managed: true },
  { key: "searxng", label: "SearXNG", role: "Búsqueda (default)", icon: Globe, managed: true },
  { key: "gemini", label: "Gemini", role: "IA (default)", icon: Bot, managed: false },
];

export function Infrastructure() {
  const { data, isLoading, isError, error, refetch } = useNodes();
  const navigate = useNavigate();
  const nodes = data?.nodes ?? [];

  // Group platform nodes by logical service.
  const liveNodeIds = useMemo(
    () => new Set(nodes.map((n) => n.id)),
    [nodes],
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Infrastructure"
        description="Estado de la flota de la plataforma y la infraestructura gestionada. Cada nodo reporta heartbeat a Telemetry."
        actions={
          <Badge variant="outline" className="gap-1">
            <Server className="h-3 w-3" /> {nodes.length} nodos
          </Badge>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {INFRA.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.key}>
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-center justify-between">
                  <Icon className="h-5 w-5 text-primary" />
                  <Badge variant={c.managed ? "secondary" : "info"}>
                    {c.managed ? "managed" : "external"}
                  </Badge>
                </div>
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-[11px] text-muted-foreground">{c.role}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
            <EmptyState title="Sin nodos" description="Ningún nodo ha reportado heartbeat recientemente." />
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

      {liveNodeIds.size === 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Sugerencia: asegúrate de que los servicios llamen a <code>telemetry.heartbeat()</code> en arranque.
        </p>
      )}
    </div>
  );
}

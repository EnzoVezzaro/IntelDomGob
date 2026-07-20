import { Link } from "react-router-dom";
import {
  KeyRound,
  Boxes,
  Server,
  Activity,
  AlertTriangle,
  Users,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { useApiKeys, useProducts, useNodes, useMetrics, useUsers, useTenants, useLogs } from "../lib/queries";
import { PageHeader, StatCard } from "../components/common/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "../components/common/States";
import { UsageChart } from "../components/charts/UsageChart";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { HeartBeat, LevelBadge } from "../components/common/badges";
import { formatCompact, formatNumber, formatRelative, formatMs } from "../lib/format";

export function Dashboard() {
  const keys = useApiKeys({});
  const products = useProducts();
  const nodes = useNodes();
  const metrics = useMetrics("global", "all", "24h");
  const users = useUsers();
  const tenants = useTenants();
  const errors = useLogs({ level: "error", limit: 6 });

  if (keys.isLoading || products.isLoading || nodes.isLoading) {
    return <LoadingState />;
  }
  if (keys.isError) return <ErrorState error={keys.error} onRetry={() => keys.refetch()} />;

  const keyList = keys.data?.keys ?? [];
  const activeKeys = keyList.filter((k) => k.active).length;
  const nodeList = nodes.data?.nodes ?? [];
  const liveNodes = nodeList.filter((n) => Date.now() - Date.parse(n.lastHeartbeat) < 300_000).length;
  const m = metrics.data;
  const totalReq = m?.requestsTotal ?? 0;
  const totalErr = m?.errorsTotal ?? 0;
  const avgLatency = totalReq ? (m?.latencySum ?? 0) / totalReq : 0;
  const errRate = totalReq ? (totalErr / totalReq) * 100 : 0;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Estado operativo de la plataforma y movimiento a través de la infraestructura en las últimas 24h."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="API Keys"
          value={formatNumber(keyList.length)}
          hint={`${activeKeys} activas`}
          icon={<KeyRound />}
        />
        <StatCard
          label="Requests (24h)"
          value={formatCompact(totalReq)}
          hint={`${formatCompact(totalErr)} errores · ${errRate.toFixed(2)}%`}
          icon={<Activity />}
          tone={errRate > 5 ? "warning" : "success"}
        />
        <StatCard
          label="Nodos"
          value={`${liveNodes}/${nodeList.length}`}
          hint={liveNodes === nodeList.length ? "Todos operativos" : "Algún nodo degradado"}
          icon={<Server />}
          tone={liveNodes === nodeList.length ? "success" : "warning"}
        />
        <StatCard
          label="Productos"
          value={formatNumber(products.data?.products.length ?? 0)}
          hint={`${tenants.data?.tenants.length ?? 0} tenants · ${users.data?.users.length ?? 0} usuarios`}
          icon={<Boxes />}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Tráfico global</CardTitle>
              <CardDescription>
                Requests y errores por minuto · latencia media {formatMs(avgLatency)}
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1">
              <Activity className="h-3 w-3" /> 24h
            </Badge>
          </CardHeader>
          <CardContent>
            {metrics.isLoading ? (
              <LoadingState />
            ) : (
              <UsageChart metric={m} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" /> Infraestructura
            </CardTitle>
            <CardDescription>Nodos de la plataforma</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {nodeList.length === 0 && <EmptyState title="Sin nodos reportados" />}
            {nodeList.slice(0, 7).map((n) => (
              <div
                key={n.id}
                className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{n.service}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {n.id}
                  </div>
                </div>
                <HeartBeat iso={n.lastHeartbeat} />
              </div>
            ))}
            {nodeList.length > 7 && (
              <Link
                to="/observability/infrastructure"
                className="flex items-center justify-center gap-1 pt-1 text-xs text-primary hover:underline"
              >
                Ver todos ({nodeList.length}) <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Errores recientes
            </CardTitle>
            <Link to="/observability/logs?level=error" className="text-xs text-primary hover:underline">
              Ver logs
            </Link>
          </CardHeader>
          <CardContent>
            {errors.isLoading ? (
              <LoadingState />
            ) : (errors.data?.logs.length ?? 0) === 0 ? (
              <EmptyState title="Sin errores recientes" description="La plataforma no ha registrado errores." />
            ) : (
              <div className="space-y-1.5">
                {errors.data?.logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
                    <LevelBadge level={log.level} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{log.message}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(log.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Superficies de producto</CardTitle>
            <CardDescription>Keys por cliente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(products.data?.products ?? []).map((p) => (
              <div key={p.product} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <span className="text-sm font-medium">{p.product}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{p.active} activas</span>
                  <Badge variant="secondary">{p.keys}</Badge>
                </div>
              </div>
            ))}
            <Link
              to="/products"
              className="flex items-center justify-center gap-1 pt-1 text-xs text-primary hover:underline"
            >
              Gestionar productos <ArrowUpRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

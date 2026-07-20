import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, Gauge, Coins, Hash, Timer } from "lucide-react";
import { useMetrics } from "../../lib/queries";
import { PageHeader, StatCard } from "../../components/common/PageHeader";
import { LoadingState, ErrorState } from "../../components/common/States";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card";
import { UsageChart } from "../../components/charts/UsageChart";
import { formatCompact, formatNumber, formatMs, formatUsd } from "../../lib/format";
import type { MetricScope } from "../../lib/types";

const SCOPES: { value: MetricScope; label: string; defaultId: string }[] = [
  { value: "global", label: "Global", defaultId: "all" },
  { value: "product", label: "Producto", defaultId: "" },
  { value: "tenant", label: "Tenant", defaultId: "" },
  { value: "apiKey", label: "API Key", defaultId: "" },
  { value: "client", label: "Cliente (key/IP)", defaultId: "" },
  { value: "node", label: "Nodo", defaultId: "" },
];

const RANGES = ["1h", "6h", "24h", "7d", "30d"];

export function Metrics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [scope, setScope] = useState<MetricScope>(
    (searchParams.get("scope") as MetricScope) || "global",
  );
  const [id, setId] = useState<string>(searchParams.get("id") || "all");
  const [range, setRange] = useState<string>(searchParams.get("range") || "24h");
  const [applied, setApplied] = useState<{ scope: MetricScope; id: string; range: string }>({
    scope: (searchParams.get("scope") as MetricScope) || "global",
    id: searchParams.get("id") || "all",
    range: searchParams.get("range") || "24h",
  });

  const { data, isLoading, isError, error, refetch } = useMetrics(
    applied.scope,
    applied.id,
    applied.range,
  );

  const totalReq = data?.requestsTotal ?? 0;
  const totalErr = data?.errorsTotal ?? 0;
  const errRate = totalReq ? (totalErr / totalReq) * 100 : 0;
  const avgLatency = totalReq ? (data?.latencySum ?? 0) / totalReq : 0;

  function pickScope(s: MetricScope) {
    setScope(s);
    const def = SCOPES.find((x) => x.value === s)?.defaultId ?? "";
    setId(def);
  }

  function apply() {
    const next = { scope, id: id.trim() || "all", range };
    setApplied(next);
    setSearchParams(
      scope === "global" ? { range } : { scope, id: next.id, range },
      { replace: true },
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Metrics"
        description="Uso, errores, latencia, tokens y costo agregados por alcance (global, producto, tenant, API key o nodo)."
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div className="space-y-2">
            <Label>Alcance</Label>
            <Select value={scope} onValueChange={(v) => pickScope(v as MetricScope)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>ID</Label>
            <Input
              className="w-[200px]"
              placeholder={scope === "global" ? "all" : "id del alcance"}
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Rango</Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={apply}>Aplicar</Button>
        </CardContent>
      </Card>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState label="Cargando métricas…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Requests" value={formatCompact(totalReq)} icon={<Hash />} />
            <StatCard
              label="Errores"
              value={formatCompact(totalErr)}
              icon={<AlertTriangle />}
              tone={errRate > 5 ? "warning" : "danger"}
            />
            <StatCard
              label="Tasa error"
              value={`${errRate.toFixed(2)}%`}
              icon={<Activity />}
              tone={errRate > 5 ? "warning" : "success"}
            />
            <StatCard label="Latencia media" value={formatMs(avgLatency)} icon={<Timer />} />
            <StatCard label="Tokens" value={formatCompact(data?.tokensTotal ?? 0)} icon={<Gauge />} tone="info" />
            <StatCard label="Costo" value={formatUsd(data?.costUsdTotal ?? 0)} icon={<Coins />} tone="info" />
          </div>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Serie temporal</CardTitle>
              <CardDescription>
                {applied.scope} / {applied.id} · {applied.range}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {totalReq === 0 ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                  Sin tráfico registrado en este alcance y rango.
                </div>
              ) : (
                <UsageChart metric={data} height={300} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

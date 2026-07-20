import { useQuery } from "@tanstack/react-query";
import { createClient } from "@intel.dom.gob/sdk";
import { listApiKeys, listNodes, listProducts, getMetrics } from "../lib/admin";
import { Card, CardTitle } from "../components/ui";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const publicClient = createClient({ baseUrl: "/api" });

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </Card>
  );
}

export function Dashboard() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => publicClient.health() });
  const keys = useQuery({ queryKey: ["keys"], queryFn: () => listApiKeys() });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: () => listNodes() });
  const products = useQuery({ queryKey: ["products"], queryFn: () => listProducts() });
  const metrics = useQuery({ queryKey: ["metrics-global"], queryFn: () => getMetrics({ scope: "global", id: "all" }) });

  const activeKeys = (keys.data?.keys ?? []).filter((k) => k.active).length;
  const series = (metrics.data?.series ?? []).map((s: any) => ({ t: new Date(s.t).toLocaleTimeString(), requests: s.requestsTotal ?? 0, errors: s.errorsTotal ?? 0 }));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Dashboard</h1>
      {health.isError && <p className="text-danger text-sm mb-4">Cannot reach API: {(health.error as Error).message}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="API status" value={health.data?.status ?? "…"} hint={`v1 · ${health.data?.apiKeyConfigured ? "key set" : "no key"}`} />
        <Stat label="API keys" value={keys.data?.total ?? "…"} hint={`${activeKeys} active`} />
        <Stat label="Nodes" value={nodes.data?.nodes?.length ?? "…"} hint="live instances" />
        <Stat label="Products" value={products.data?.products?.length ?? "…"} hint="client surfaces" />
      </div>

      <Card className="mt-6">
        <CardTitle>Requests (global, last window)</CardTitle>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 20%)" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: "hsl(215 20% 60%)" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(215 20% 60%)" }} />
              <Tooltip contentStyle={{ background: "hsl(222 40% 11%)", border: "1px solid hsl(220 13% 20%)" }} />
              <Line type="monotone" dataKey="requests" stroke="hsl(199 89% 48%)" dot={false} />
              <Line type="monotone" dataKey="errors" stroke="hsl(0 72% 51%)" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

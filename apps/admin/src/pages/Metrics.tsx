import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMetrics } from "../lib/admin";
import { Card, CardTitle, Input, Select } from "../components/ui";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const SCOPES = ["global", "product", "tenant", "apiKey", "node"] as const;

export function Metrics() {
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("global");
  const [id, setId] = useState("all");
  const [nonce, setNonce] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["metrics", scope, id, nonce],
    queryFn: () => getMetrics({ scope, id }),
    refetchInterval: 5000,
  });

  const series = (data?.series ?? []).map((s: any) => ({
    t: new Date(s.t).toLocaleTimeString(),
    requests: s.requestsTotal ?? 0,
    errors: s.errorsTotal ?? 0,
    tokens: s.tokensTotal ?? 0,
    cost: s.costUsdTotal ?? 0,
  }));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Metrics</h1>
      <div className="flex gap-3 mb-4 flex-wrap">
        <Select value={scope} onChange={(e) => setScope(e.target.value as any)}>
          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Input placeholder={scope === "global" ? "all" : `${scope} id`} value={id} onChange={(e) => setId(e.target.value)} />
        <button className="text-sm text-primary" onClick={() => setNonce((n) => n + 1)}>Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card><div className="text-xs text-muted">Requests</div><div className="text-2xl font-semibold">{data?.requestsTotal ?? "…"}</div></Card>
        <Card><div className="text-xs text-muted">Errors</div><div className="text-2xl font-semibold text-danger">{data?.errorsTotal ?? "…"}</div></Card>
        <Card><div className="text-xs text-muted">Tokens</div><div className="text-2xl font-semibold">{data?.tokensTotal ?? "…"}</div></Card>
        <Card><div className="text-xs text-muted">Cost (USD)</div><div className="text-2xl font-semibold">{Number(data?.costUsdTotal ?? 0).toFixed(4)}</div></Card>
      </div>

      <Card>
        <CardTitle>Requests vs Errors over time</CardTitle>
        <div className="h-72">
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

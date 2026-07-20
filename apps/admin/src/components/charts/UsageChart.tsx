import {
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  ComposedChart,
} from "recharts";
import type { MetricPoint } from "../../lib/types";
import { formatDateTime, formatCompact } from "../../lib/format";

interface Props {
  metric?: MetricPoint;
  height?: number;
  showErrors?: boolean;
}

function bucketLabel(t: number): string {
  const d = new Date(t);
  const diff = Date.now() - t;
  if (diff < 24 * 3600 * 1000) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function UsageChart({ metric, height = 260, showErrors = true }: Props) {
  const data = (metric?.series ?? [])
    .filter((s) => s.t)
    .map((s) => ({
      t: s.t,
      requests: s.requestsTotal ?? 0,
      errors: s.errorsTotal ?? 0,
      latency: s.latencySum ?? 0,
      tokens: s.tokensTotal ?? 0,
      cost: s.costUsdTotal ?? 0,
    }))
    .sort((a, b) => a.t - b.t);

  if (!data.length) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        Sin datos en el rango seleccionado.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={bucketLabel}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          stroke="hsl(var(--border))"
          minTickGap={32}
        />
        <YAxis
          tickFormatter={(v) => formatCompact(v)}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          stroke="hsl(var(--border))"
          width={44}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(t) => formatDateTime(String(t))}
          formatter={(value, name) => {
            const labels: Record<string, string> = {
              requests: "Requests",
              errors: "Errors",
              latency: "Latency sum (ms)",
              tokens: "Tokens",
              cost: "Cost (USD)",
            };
            return [formatCompact(Number(value)), labels[String(name)] ?? String(name)];
          }}
        />
        <Area
          type="monotone"
          dataKey="requests"
          name="requests"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#reqFill)"
        />
        {showErrors && (
          <Line
            type="monotone"
            dataKey="errors"
            name="errors"
            stroke="hsl(var(--destructive))"
            strokeWidth={2}
            dot={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

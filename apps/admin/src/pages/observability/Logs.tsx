import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ScrollText, Search, Radio, Pause, Play, Filter } from "lucide-react";
import { useLogs } from "../../lib/queries";
import { PageHeader } from "../../components/common/PageHeader";
import { LoadingState, ErrorState } from "../../components/common/States";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { LevelBadge } from "../../components/common/badges";
import { formatDateTime, formatRelative } from "../../lib/format";

const RANGES: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function LiveLogs() {
  const [searchParams] = useSearchParams();
  const [level, setLevel] = useState<string>(searchParams.get("level") ?? "all");
  const [service, setService] = useState<string>("all");
  const [product, setProduct] = useState<string>("all");
  const [node, setNode] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<string>("1h");
  const [live, setLive] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = useMemo(() => {
    const from = new Date(Date.now() - (RANGES[range] ?? RANGES["1h"])).toISOString();
    const p: Record<string, string | number | undefined> = { from, limit: 300 };
    if (level !== "all") p.level = level;
    if (service !== "all") p.service = service;
    if (product !== "all") p.product = product;
    if (node !== "all") p.node = node;
    if (search.trim()) p.search = search.trim();
    if (live) p.live = "true";
    return p;
  }, [level, service, product, node, search, range, live]);

  const { data, isLoading, isError, error, refetch } = useLogs(params);
  const logs = data?.logs ?? [];

  const services = useMemo(
    () => Array.from(new Set(logs.map((l) => l.service))).sort(),
    [logs],
  );
  const nodes = useMemo(
    () => Array.from(new Set(logs.map((l) => l.node).filter(Boolean))) as string[],
    [logs],
  );
  const products = useMemo(
    () => Array.from(new Set(logs.map((l) => l.product).filter(Boolean))) as string[],
    [logs],
  );

  function copyJson(log: Record<string, string>) {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    toast.success("JSON copiado.");
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Live Logs"
        description="Trazabilidad completa de todo lo que transita por la infraestructura, filtrable por servicio, tenant, producto, nodo y API key."
        actions={
          <Button variant={live ? "default" : "outline"} onClick={() => setLive((v) => !v)}>
            {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {live ? "En vivo" : "Pausado"}
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar en mensajes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos niveles</SelectItem>
            <SelectItem value="debug">debug</SelectItem>
            <SelectItem value="info">info</SelectItem>
            <SelectItem value="warn">warn</SelectItem>
            <SelectItem value="error">error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Servicio" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos servicios</SelectItem>
            {services.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={product} onValueChange={setProduct}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Producto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo producto</SelectItem>
            {products.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={node} onValueChange={setNode}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Nodo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo nodo</SelectItem>
            {nodes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(RANGES).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="gap-1">
          <Radio className={live ? "h-3 w-3 text-success animate-pulse-dot" : "h-3 w-3 text-muted-foreground"} />
          {isLoading ? "cargando" : `${logs.length} / ${data?.total ?? 0}`}
        </Badge>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading && logs.length === 0 ? (
        <LoadingState label="Obteniendo telemetría…" />
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-14 text-center">
          <Filter className="h-6 w-6 text-muted-foreground" />
          <div className="text-sm">Sin logs en este rango/filtro.</div>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">Timestamp</TableHead>
                <TableHead className="w-[80px]">Nivel</TableHead>
                <TableHead className="w-[150px]">Servicio</TableHead>
                <TableHead>Mensaje</TableHead>
                <TableHead className="w-[160px]">Correlación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const corr = [log.product, log.tenantId, log.node, log.apiKeyId].filter(Boolean).join(" · ");
                const isOpen = expanded === log.id;
                return (
                  <Fragment key={log.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : log.id)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <div title={formatDateTime(log.timestamp)}>{formatRelative(log.timestamp)}</div>
                        <div className="opacity-60">{formatDateTime(log.timestamp).split(",")[1]}</div>
                      </TableCell>
                      <TableCell><LevelBadge level={log.level} /></TableCell>
                      <TableCell className="font-mono text-xs">{log.service}</TableCell>
                      <TableCell className="max-w-0">
                        <div className="truncate font-mono text-xs">{log.message}</div>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate font-mono text-[11px] text-muted-foreground" title={corr}>
                        {corr || "—"}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${log.id}-detail`} className="bg-muted/30">
                        <TableCell colSpan={5} className="p-0">
                          <div className="space-y-2 p-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-muted-foreground">Detalle del evento</span>
                              <Button size="sm" variant="ghost"                       onClick={(e) => { e.stopPropagation(); copyJson(log as unknown as Record<string, string>); }}>
                                Copiar JSON
                              </Button>
                            </div>
                            <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-3 font-mono text-xs">
{JSON.stringify(log, null, 2)}
                            </pre>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

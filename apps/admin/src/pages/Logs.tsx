import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryLogs } from "../lib/admin";
import { Button, Card, CardTitle, Input, Select, Table, Td, Th } from "../components/ui";

const LEVELS = ["", "debug", "info", "warn", "error"];

export function Logs() {
  const [service, setService] = useState("");
  const [level, setLevel] = useState("");
  const [product, setProduct] = useState("");
  const [search, setSearch] = useState("");
  const [auto, setAuto] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["logs", service, level, product, search, nonce],
    queryFn: () => queryLogs({ service: service || undefined, level: level || undefined, product: product || undefined, search: search || undefined, limit: 300 }),
    refetchInterval: auto ? 4000 : false,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Logs</h1>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Live tail (4s)
        </label>
      </div>
      <div className="flex gap-3 mb-4 flex-wrap">
        <Input placeholder="search message…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Input placeholder="service" value={service} onChange={(e) => setService(e.target.value)} />
        <Select value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => <option key={l} value={l}>{l || "any level"}</option>)}
        </Select>
        <Input placeholder="product" value={product} onChange={(e) => setProduct(e.target.value)} />
        <Button variant="outline" onClick={() => setNonce((n) => n + 1)} disabled={isFetching}>Refresh</Button>
      </div>
      <Card>
        <div className="max-h-[70vh] overflow-auto font-mono text-xs">
          <Table>
            <tbody>
              {data?.logs.map((l, i) => (
                <tr key={l.id ?? i} className="border-b border-border/50">
                  <Td className="whitespace-nowrap text-muted w-40">{l.timestamp}</Td>
                  <Td className="whitespace-nowrap w-16">
                    <span className={l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warn" : "text-muted"}>{l.level}</span>
                  </Td>
                  <Td className="whitespace-nowrap w-32 text-primary">{l.service}</Td>
                  <Td className="whitespace-nowrap w-24 text-ok">{l.product ?? ""}</Td>
                  <Td className="whitespace-nowrap w-28 text-muted">{l.apiKeyId ?? ""}</Td>
                  <Td>{l.message}</Td>
                </tr>
              ))}
              {data && data.logs.length === 0 && <tr><Td className="text-muted">No logs.</Td></tr>}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

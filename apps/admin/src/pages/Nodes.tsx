import { useQuery } from "@tanstack/react-query";
import { listNodes } from "../lib/admin";
import { Badge, Card, CardTitle, Table, Td, Th } from "../components/ui";

export function Nodes() {
  const { data, isLoading } = useQuery({ queryKey: ["nodes"], queryFn: () => listNodes(), refetchInterval: 5000 });
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Nodes</h1>
      <p className="text-sm text-muted mb-4">Live platform instances reporting heartbeats. Used for fleet-wide log/metric attribution.</p>
      <Card>
        <Table>
          <thead><tr><Th>ID</Th><Th>Service</Th><Th>Host</Th><Th>Last heartbeat</Th></tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={4} className="text-muted">Loading…</Td></tr>}
            {data?.nodes.map((n) => (
              <tr key={n.id}>
                <Td className="font-mono text-xs">{n.id}</Td>
                <Td><Badge tone="primary">{n.service}</Badge></Td>
                <Td className="text-muted">{n.host ?? "—"}</Td>
                <Td className="text-muted">{n.lastHeartbeat}</Td>
              </tr>
            ))}
            {data && data.nodes.length === 0 && <tr><Td colSpan={4} className="text-muted">No nodes.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

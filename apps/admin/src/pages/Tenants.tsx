import { useQuery } from "@tanstack/react-query";
import { listTenants } from "../lib/admin";
import { Badge, Card, CardTitle, Table, Td, Th } from "../components/ui";

export function Tenants() {
  const { data, isLoading } = useQuery({ queryKey: ["tenants"], queryFn: () => listTenants() });
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Tenants</h1>
      <p className="text-sm text-muted mb-4">Tenants carry the billing plan. Tie an API key to a tenant to apply that plan's quota.</p>
      <Card>
        <Table>
          <thead><tr><Th>Slug</Th><Th>Name</Th><Th>Plan</Th><Th>ID</Th></tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={4} className="text-muted">Loading…</Td></tr>}
            {data?.tenants.map((t) => (
              <tr key={t.id}>
                <Td>{t.slug}</Td>
                <Td>{t.name}</Td>
                <Td><Badge tone="primary">{t.plan}</Badge></Td>
                <Td className="text-muted text-xs">{t.id}</Td>
              </tr>
            ))}
            {data && data.tenants.length === 0 && <tr><Td colSpan={4} className="text-muted">No tenants.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

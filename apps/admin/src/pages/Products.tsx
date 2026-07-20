import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listProducts } from "../lib/admin";
import { Badge, Card, CardTitle, Table, Td, Th } from "../components/ui";

export function Products() {
  const { data, isLoading } = useQuery({ queryKey: ["products"], queryFn: () => listProducts() });
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Products (client surfaces)</h1>
      <p className="text-sm text-muted mb-4">Every client surface connecting to the API must present an API key. Track them per product below.</p>
      <Card>
        <Table>
          <thead>
            <tr><Th>Product</Th><Th>Total keys</Th><Th>Active</Th><Th></Th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><Td colSpan={4} className="text-muted">Loading…</Td></tr>}
            {data?.products.map((p) => (
              <tr key={p.product}>
                <Td><Badge tone="primary">{p.product}</Badge></Td>
                <Td>{p.keys}</Td>
                <Td>{p.active}</Td>
                <Td><Link className="text-primary text-sm hover:underline" to={`/apikeys?product=${p.product}`}>View keys</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

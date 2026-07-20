import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activateApiKey, createApiKey, deleteApiKey, listApiKeys, revokeApiKey } from "../lib/admin";
import { Badge, Button, Card, CardTitle, Input, Select, Table, Td, Th } from "../components/ui";

const PRODUCTS = ["studio", "web", "cli", "mcp", "sdk", "custom"];
const PLANS = ["free", "publico", "investigador", "pro", "institucional"];
const PAYMENTS = ["ok", "pending", "overdue", "suspended"];

export function ApiKeys() {
  const qc = useQueryClient();
  const [product, setProduct] = useState("");
  const [active, setActive] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", product: "studio", plan: "free", tenantId: "", quotaDaily: "", rateLimit: "", paymentStatus: "ok" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["keys", product, active],
    queryFn: () => listApiKeys({ product: product || undefined, active: active || undefined }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["keys"] });

  const revoke = useMutation({ mutationFn: (id: string) => revokeApiKey(id), onSuccess: invalidate });
  const activate = useMutation({ mutationFn: (id: string) => activateApiKey(id), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => deleteApiKey(id), onSuccess: invalidate });
  const create = useMutation({
    mutationFn: () => createApiKey({
      name: form.name,
      product: form.product,
      plan: form.plan,
      tenantId: form.tenantId || undefined,
      quotaDaily: form.quotaDaily ? Number(form.quotaDaily) : 0,
      rateLimit: form.rateLimit ? Number(form.rateLimit) : 0,
      paymentStatus: form.paymentStatus,
    }),
    onSuccess: (r) => {
      setNewKey(r.key);
      setCreating(false);
      setForm({ name: "", product: "studio", plan: "free", tenantId: "", quotaDaily: "", rateLimit: "", paymentStatus: "ok" });
      invalidate();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    create.mutate();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New key"}</Button>
      </div>

      {creating && (
        <Card className="mb-4">
          <CardTitle>Create API key</CardTitle>
          <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
              {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Input placeholder="Tenant ID (optional)" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} />
            <Input type="number" placeholder="Daily quota (0=∞)" value={form.quotaDaily} onChange={(e) => setForm({ ...form, quotaDaily: e.target.value })} />
            <Input type="number" placeholder="Rate limit/min (0=∞)" value={form.rateLimit} onChange={(e) => setForm({ ...form, rateLimit: e.target.value })} />
            <Select value={form.paymentStatus} onChange={(e) => setForm({ ...form, paymentStatus: e.target.value })}>
              {PAYMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
          </form>
          {newKey && (
            <div className="mt-3 p-3 rounded bg-background border border-border">
              <p className="text-xs text-muted mb-1">Copy this key now — it won't be shown again:</p>
              <code className="text-sm break-all text-ok">{newKey}</code>
              <Button className="ml-3" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(newKey)}>Copy</Button>
            </div>
          )}
        </Card>
      )}

      <div className="flex gap-3 mb-4">
        <Select value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">All products</option>
          {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Revoked</option>
        </Select>
      </div>

      {error && <p className="text-danger text-sm">{(error as Error).message}</p>}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th><Th>Product</Th><Th>Plan</Th><Th>Quota/day</Th><Th>Rate/min</Th><Th>Payment</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><Td colSpan={8} className="text-muted">Loading…</Td></tr>}
            {data?.keys.map((k) => (
              <tr key={k.id}>
                <Td>{k.name}</Td>
                <Td><Badge tone="primary">{k.product}</Badge></Td>
                <Td>{k.plan}</Td>
                <Td>{k.quotaDaily || "∞"}</Td>
                <Td>{k.rateLimit || "∞"}</Td>
                <Td><Badge tone={k.paymentStatus === "ok" ? "ok" : "warn"}>{k.paymentStatus}</Badge></Td>
                <Td>{k.active ? <Badge tone="ok">active</Badge> : <Badge tone="danger">revoked</Badge>}</Td>
                <Td className="flex gap-2">
                  {k.active ? (
                    <Button size="sm" variant="outline" onClick={() => revoke.mutate(k.id)}>Revoke</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => activate.mutate(k.id)}>Activate</Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => remove.mutate(k.id)}>Delete</Button>
                </Td>
              </tr>
            ))}
            {data && data.keys.length === 0 && <tr><Td colSpan={8} className="text-muted">No keys.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

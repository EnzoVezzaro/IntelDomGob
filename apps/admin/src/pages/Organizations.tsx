import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrganization, listOrganizations } from "../lib/admin";
import { Button, Card, CardTitle, Input, Table, Td, Th } from "../components/ui";

export function Organizations() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["orgs"], queryFn: () => listOrganizations() });
  const [form, setForm] = useState({ name: "", slug: "", tenantId: "" });
  const create = useMutation({ mutationFn: () => createOrganization(form), onSuccess: () => { qc.invalidateQueries({ queryKey: ["orgs"] }); setForm({ name: "", slug: "", tenantId: "" }); } });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.slug) return;
    create.mutate();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Organizations</h1>
      <Card className="mb-4">
        <CardTitle>Add organization</CardTitle>
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <Input placeholder="Tenant ID" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} />
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Adding…" : "Add"}</Button>
        </form>
      </Card>
      <Card>
        <Table>
          <thead><tr><Th>Name</Th><Th>Slug</Th><Th>Tenant</Th></tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={3} className="text-muted">Loading…</Td></tr>}
            {data?.organizations.map((o) => (
              <tr key={o.id}>
                <Td>{o.name}</Td>
                <Td>{o.slug}</Td>
                <Td className="text-muted">{o.tenantId ?? "—"}</Td>
              </tr>
            ))}
            {data && data.organizations.length === 0 && <tr><Td colSpan={3} className="text-muted">No organizations.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, listUsers } from "../lib/admin";
import { Badge, Button, Card, CardTitle, Input, Table, Td, Th } from "../components/ui";

export function Users() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  const [form, setForm] = useState({ email: "", displayName: "", role: "member", organizationId: "" });
  const create = useMutation({ mutationFn: () => createUser(form), onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setForm({ email: "", displayName: "", role: "member", organizationId: "" }); } });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.email) return;
    create.mutate();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Employees</h1>
      <Card className="mb-4">
        <CardTitle>Add employee</CardTitle>
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <Input placeholder="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          <Input placeholder="Organization ID" value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} />
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Adding…" : "Add"}</Button>
        </form>
      </Card>
      <Card>
        <Table>
          <thead><tr><Th>Email</Th><Th>Name</Th><Th>Role</Th><Th>Org</Th></tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={4} className="text-muted">Loading…</Td></tr>}
            {data?.users.map((u) => (
              <tr key={u.id}>
                <Td>{u.email}</Td>
                <Td>{u.displayName ?? "—"}</Td>
                <Td><Badge>{u.role}</Badge></Td>
                <Td className="text-muted">{u.organizationId ?? "—"}</Td>
              </tr>
            ))}
            {data && data.users.length === 0 && <tr><Td colSpan={4} className="text-muted">No employees.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

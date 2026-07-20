import { useState } from "react";
import { toast } from "sonner";
import { Plus, Users as UsersIcon, Mail } from "lucide-react";
import { useUsers, useCreateUser, useOrganizations } from "../lib/queries";
import { PageHeader } from "../components/common/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "../components/common/States";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { initials, formatDateTime } from "../lib/format";

export function Users() {
  const { data, isLoading, isError, error, refetch } = useUsers();
  const orgs = useOrganizations();
  const create = useCreateUser();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("member");
  const [orgId, setOrgId] = useState<string>("none");

  async function submit() {
    if (!email.trim()) {
      toast.error("El email es obligatorio.");
      return;
    }
    try {
      await create.mutateAsync({
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        role,
        organizationId: orgId === "none" ? undefined : orgId,
      });
      toast.success("Usuario creado.");
      setOpen(false);
      setEmail("");
      setDisplayName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear.");
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Users"
        description="Empleados y cuentas vinculadas a organizaciones de la plataforma."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" /> Nuevo usuario</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo usuario</DialogTitle>
                <DialogDescription>Crea una cuenta de empleado vinculada a una organización.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@org.gob.do" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dn">Nombre a mostrar</Label>
                  <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Rol</Label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">member</SelectItem>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="owner">owner</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Organización</Label>
                    <Select value={orgId} onValueChange={setOrgId}>
                      <SelectTrigger><SelectValue placeholder="Ninguna" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ninguna</SelectItem>
                        {(orgs.data?.organizations ?? []).map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Creando…" : "Crear"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (data?.users.length ?? 0) === 0 ? (
        <EmptyState title="Sin usuarios" description="Crea el primer usuario para esta plataforma." icon={<UsersIcon className="h-6 w-6" />} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Organización</TableHead>
                <TableHead>Creado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{initials(u.displayName ?? u.email)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">{u.displayName ?? "—"}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{u.id}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" /> {u.email}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.organizationId ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

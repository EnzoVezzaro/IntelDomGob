import { useState } from "react";
import { toast } from "sonner";
import { Plus, Building2 } from "lucide-react";
import { useOrganizations, useCreateOrganization, useTenants } from "../lib/queries";
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
import { formatDateTime } from "../lib/format";

export function Organizations() {
  const { data, isLoading, isError, error, refetch } = useOrganizations();
  const tenants = useTenants();
  const create = useCreateOrganization();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tenantId, setTenantId] = useState<string>("none");

  async function submit() {
    if (!name.trim() || !slug.trim()) {
      toast.error("Nombre y slug son obligatorios.");
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        slug: slug.trim(),
        tenantId: tenantId === "none" ? undefined : tenantId,
      });
      toast.success("Organización creada.");
      setOpen(false);
      setName("");
      setSlug("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear.");
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Organizations"
        description="Agrupaciones de usuarios y API keys con aislamiento de datos por tenant."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" /> Nueva organización</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva organización</DialogTitle>
                <DialogDescription>Crea una organización y asígnale un tenant.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="oname">Nombre *</Label>
                  <Input id="oname" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="oslug">Slug *</Label>
                  <Input id="oslug" value={slug} onChange={(e) => setSlug(e.target.value.replace(/\s+/g, "-").toLowerCase())} placeholder="acme" />
                </div>
                <div className="space-y-2">
                  <Label>Tenant</Label>
                  <Select value={tenantId} onValueChange={setTenantId}>
                    <SelectTrigger><SelectValue placeholder="Ninguno" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ninguno</SelectItem>
                      {(tenants.data?.tenants ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
      ) : (data?.organizations.length ?? 0) === 0 ? (
        <EmptyState title="Sin organizaciones" description="Crea la primera organización." icon={<Building2 className="h-6 w-6" />} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Creado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.organizations.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{o.slug}</code></TableCell>
                  <TableCell>{o.tenantId ? <Badge variant="outline">{o.tenantId}</Badge> : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

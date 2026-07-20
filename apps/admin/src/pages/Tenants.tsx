import { Layers } from "lucide-react";
import { useTenants } from "../lib/queries";
import { PageHeader } from "../components/common/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "../components/common/States";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { PlanBadge } from "../components/common/badges";
import { formatDateTime } from "../lib/format";

export function Tenants() {
  const { data, isLoading, isError, error, refetch } = useTenants();

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Tenants"
        description="Aislamiento multi-tenant de datos y resolución de identidad por credencial."
      />

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (data?.tenants.length ?? 0) === 0 ? (
        <EmptyState title="Sin tenants" description="Aún no hay tenants registrados." icon={<Layers className="h-6 w-6" />} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Creado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.slug}</code></TableCell>
                  <TableCell><PlanBadge plan={t.plan} /></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(t.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

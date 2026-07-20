import { useNavigate } from "react-router-dom";
import { Boxes, KeyRound, ArrowRight } from "lucide-react";
import { useProducts } from "../lib/queries";
import { PageHeader } from "../components/common/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "../components/common/States";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { formatNumber } from "../lib/format";

export function Products() {
  const { data, isLoading, isError, error, refetch } = useProducts();
  const navigate = useNavigate();
  const products = data?.products ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Products"
        description="Superficies de cliente (Studio, Web, CLI, MCP, SDK) y su base de credenciales."
      />

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : products.length === 0 ? (
        <EmptyState title="Sin productos" description="No hay keys emitidas todavía." icon={<Boxes className="h-6 w-6" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const pct = p.keys ? Math.round((p.active / p.keys) * 100) : 0;
            return (
              <Card key={p.product} className="transition-colors hover:border-primary/40">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Boxes className="h-4 w-4 text-primary" /> {p.product}
                  </CardTitle>
                  <Badge variant="secondary">{formatNumber(p.keys)} keys</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-semibold tabular-nums text-success">{p.active}</div>
                      <div className="text-xs text-muted-foreground">activas ({pct}%)</div>
                    </div>
                    <KeyRound className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate(`/apikeys?product=${p.product}`)}
                  >
                    Gestionar keys <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

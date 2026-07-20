import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, KeyRound, AlertCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const ok = await login(value);
      if (ok) navigate("/", { replace: true });
      else setError("That key is not valid or lacks the admin scope.");
    } catch {
      setError("Could not reach the API. Is the platform up?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-grid p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">
              INTEL.DOM.GOB
            </div>
            <div className="text-xs text-muted-foreground">
              Admin Console · Operador
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" /> Acceso de operador
            </CardTitle>
            <CardDescription>
              Introduce la API key con alcance <code className="rounded bg-muted px-1">admin</code>.
              Se almacena solo en este navegador.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key">API Key</Label>
                <Input
                  id="key"
                  type="password"
                  autoFocus
                  placeholder="idg_admin_…"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Verificando…" : "Entrar"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Plataforma de Inteligencia Gubernamental del Estado Dominicano
        </p>
      </div>
    </div>
  );
}

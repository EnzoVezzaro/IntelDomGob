import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setToken } from "../lib/admin";
import { Button, Card, CardTitle, Input } from "../components/ui";

export function Login() {
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setError("Enter your admin API key.");
      return;
    }
    setToken(token.trim());
    navigate("/", { replace: true });
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardTitle>INTEL.DOM.GOB — Admin</CardTitle>
        <p className="text-sm text-muted mb-4">Sign in with an admin-scoped API key. The key is stored only in this browser session.</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="admin API key (idg_admin_...)"
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            autoFocus
          />
          {error && <p className="text-danger text-sm">{error}</p>}
          <Button type="submit">Sign in</Button>
        </form>
      </Card>
    </div>
  );
}

import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { ApiKeys } from "./pages/ApiKeys";
import { Users } from "./pages/Users";
import { Organizations } from "./pages/Organizations";
import { Tenants } from "./pages/Tenants";
import { Products } from "./pages/Products";
import { LiveLogs } from "./pages/observability/Logs";
import { Metrics } from "./pages/observability/Metrics";
import { Infrastructure } from "./pages/observability/Infrastructure";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { authed, checking } = useAuth();
  const loc = useLocation();
  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!authed) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/apikeys" element={<ApiKeys />} />
                <Route path="/users" element={<Users />} />
                <Route path="/organizations" element={<Organizations />} />
                <Route path="/tenants" element={<Tenants />} />
                <Route path="/products" element={<Products />} />
                <Route path="/observability" element={<Navigate to="/observability/logs" replace />} />
                <Route path="/observability/logs" element={<LiveLogs />} />
                <Route path="/observability/metrics" element={<Metrics />} />
                <Route path="/observability/infrastructure" element={<Infrastructure />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

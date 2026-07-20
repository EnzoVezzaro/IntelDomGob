import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { hasToken } from "./lib/admin";
import { Login } from "./pages/Login";
import { Shell } from "./layouts/Shell";
import { Dashboard } from "./pages/Dashboard";
import { ApiKeys } from "./pages/ApiKeys";
import { Products } from "./pages/Products";
import { Logs } from "./pages/Logs";
import { Metrics } from "./pages/Metrics";
import { Users } from "./pages/Users";
import { Organizations } from "./pages/Organizations";
import { Tenants } from "./pages/Tenants";
import { Nodes } from "./pages/Nodes";

export function App() {
  const authed = hasToken();
  const loc = useLocation();
  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
      </Routes>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/apikeys" element={<ApiKeys />} />
        <Route path="/products" element={<Products />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/metrics" element={<Metrics />} />
        <Route path="/users" element={<Users />} />
        <Route path="/organizations" element={<Organizations />} />
        <Route path="/tenants" element={<Tenants />} />
        <Route path="/nodes" element={<Nodes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

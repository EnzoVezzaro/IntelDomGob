import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { setToken } from "../lib/admin";
import { cn } from "../lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/apikeys", label: "API Keys" },
  { to: "/products", label: "Products" },
  { to: "/logs", label: "Logs" },
  { to: "/metrics", label: "Metrics" },
  { to: "/users", label: "Employees" },
  { to: "/organizations", label: "Organizations" },
  { to: "/tenants", label: "Tenants" },
  { to: "/nodes", label: "Nodes" },
];

export function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-border bg-surface p-4 flex flex-col">
        <div className="text-primary font-semibold mb-6">INTEL.DOM.GOB<span className="block text-xs text-muted font-normal">Admin Console</span></div>
        <nav className="flex flex-col gap-1 text-sm">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("px-3 py-2 rounded-md", isActive ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground hover:bg-background")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="mt-auto text-xs text-muted hover:text-danger"
          onClick={() => {
            setToken("");
            navigate("/login", { replace: true });
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}

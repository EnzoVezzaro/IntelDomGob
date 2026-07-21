import { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  KeyRound,
  Users,
  Building2,
  Layers,
  Boxes,
  Users2,
  ScrollText,
  Activity,
  Server,
  LogOut,
  Radio,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { cn } from "../../lib/utils";
import { useNodes } from "../../lib/queries";
import { formatRelative } from "../../lib/format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode; end?: boolean }[] }[] = [
  {
    group: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: <LayoutDashboard />, end: true }],
  },
  {
    group: "Identity & Access",
    items: [
      { to: "/apikeys", label: "API Keys", icon: <KeyRound /> },
      { to: "/users", label: "Users", icon: <Users /> },
      { to: "/organizations", label: "Organizations", icon: <Building2 /> },
      { to: "/tenants", label: "Tenants", icon: <Layers /> },
    ],
  },
  {
    group: "Products",
    items: [
      { to: "/products", label: "Products", icon: <Boxes /> },
      { to: "/clients", label: "Clients", icon: <Users2 /> },
    ],
  },
  {
    group: "Observability",
    items: [
      { to: "/observability/logs", label: "Live Logs", icon: <ScrollText /> },
      { to: "/observability/metrics", label: "Metrics", icon: <Activity /> },
      { to: "/observability/infrastructure", label: "Infrastructure", icon: <Server /> },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const { data: nodes } = useNodes();

  const liveNodes = (nodes?.nodes ?? []).filter(
    (n) => Date.now() - Date.parse(n.lastHeartbeat) < 300_000,
  ).length;

  return (
    <div className="flex h-screen overflow-hidden bg-grid">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
          <pre className="ascii mini" aria-hidden="true">
{` ██╗███╗    ████╗   
 ██║   ██╗██║   ██╗
 ██║   ██║██║   ██║
 ██║   ██║██║   ██║
 ██████║    ████║  
 ╚═════╝    ╚═══╝  `}
          </pre>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">INTEL.DOM.GOB</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Admin Console
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {NAV.map((section) => (
            <div key={section.group}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.group}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )
                    }
                  >
                    <span className="[&_svg]:size-4">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs">
            <Radio className={cn("h-3.5 w-3.5", liveNodes > 0 ? "text-success animate-pulse-dot" : "text-destructive")} />
            <span className="text-muted-foreground">
              {liveNodes} nodo{liveNodes === 1 ? "" : "s"} activo{liveNodes === 1 ? "" : "s"}
            </span>
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/40 px-6">
          <div className="text-sm font-medium text-muted-foreground">
            {loc.pathname === "/" ? "Dashboard" : loc.pathname.replace("/", "")}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse-dot" />
                Telemetry en vivo
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Los logs y métricas se actualizan automáticamente.
            </TooltipContent>
          </Tooltip>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

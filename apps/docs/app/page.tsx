import Link from "next/link";

type Product = {
  name: string;
  tagline: string;
  description: string;
  status: "live" | "soon";
  href?: string;
  external?: boolean;
  badge?: string;
};

const PRODUCTS: Product[] = [
  {
    name: "API",
    tagline: "API gubernamental",
    description:
      "Punto de entrada API-first de toda la plataforma. Cada capacidad se expone vía HTTP y un servidor MCP. Úsala para construir sobre INTEL.DOM.GOB.",
    status: "live",
    badge: "api.intel.dom.gob",
    href: "https://api.intel.dom.gob/docs",
    external: true,
  },
  {
    name: "Studio",
    tagline: "IntelDomGob Studio",
    description:
      "Espacio de trabajo multi-agente (fork AGPL-3.0 de Odysseus) que se conecta a la plataforma únicamente vía el servidor MCP. Chat, agentes, investigación y más.",
    status: "live",
    badge: "studio.intel.dom.gob",
    href: "https://studio.intel.dom.gob",
    external: true,
  },
  {
    name: "MCP",
    tagline: "Servidor MCP",
    description:
      "Superficie de Model Context Protocol (Streamable HTTP + SSE). Studio, la CLI y cualquier cliente estándar de MCP se conectan por igual.",
    status: "live",
    badge: "mcp.intel.dom.gob/mcp",
    href: "https://mcp.intel.dom.gob/health",
    external: true,
  },
  {
    name: "Web",
    tagline: "Sitio web público",
    description:
      "Nuestro sitio web público (solo SDK): página de producto + demo en vivo que consulta fuentes oficiales sin instalar nada. Funciona sin cuenta ni API key.",
    status: "live",
    href: "https://web.intel.dom.gob",
    external: true,
  },
  {
    name: "CLI",
    tagline: "Cliente de terminal",
    description:
      "Cliente de terminal interactivo (estilo OpenCode) que se conecta vía MCP. Para desarrolladores y automatización.",
    status: "live",
    badge: "npm: @intel.dom.gob/app-cli",
    href: "/docs/products",
  },
  {
    name: "Docs",
    tagline: "Documentación del proyecto",
    description:
      "Documentación de todos los productos: arquitectura, proveedores, servicios, API, despliegue y desarrollo.",
    status: "live",
    href: "/docs/",
  },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              ID
            </span>
            <span>INTEL.DOM.GOB</span>
          </div>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/docs/" className="transition-colors hover:text-foreground">
              Documentación
            </Link>
            <a
              href="https://www.agentix.com.do/"
              className="transition-colors hover:text-foreground"
            >
              Agentix
            </a>
          </nav>
        </div>
      </header>

      <section className="mx-auto flex max-w-5xl flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <span className="mb-6 inline-flex items-center rounded-full border border-border bg-muted px-4 py-1 text-xs font-medium text-muted-foreground">
          Plataforma de Inteligencia Gubernamental
        </span>
        <h1 className="mb-5 max-w-3xl text-5xl font-bold tracking-tight">
          INTEL.DOM.GOB
        </h1>
        <p className="mb-3 max-w-2xl text-xl text-muted-foreground">
          Plataforma de Inteligencia Gubernamental del Estado Dominicano
         </p>
        <p className="mb-10 max-w-2xl text-muted-foreground">
          API-first, multi-agente, basada en evidencia oficial. Documentación de
          todos los productos en un solo lugar.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/docs/"
            className="inline-flex h-11 items-center rounded-lg bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ver documentación
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <h2 className="mb-2 text-lg font-semibold">Productos</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          INTEL.DOM.GOB es un ecosistema de productos. Esta documentación
          cubre todos ellos.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((p) => {
            const card = (
              <div className="flex h-full flex-col rounded-xl border border-border bg-card p-6 text-card-foreground">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  {p.status === "live" ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      En vivo
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Próximamente
                    </span>
                  )}
                </div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">
                  {p.tagline}
                </p>
                <p className="mb-4 text-sm text-muted-foreground">{p.description}</p>
                <div className="mt-auto text-xs text-muted-foreground">
                  {p.badge ?? (p.href ? (p.external ? p.href : p.href) : "")}
                </div>
              </div>
            );
            return p.href ? (
              <a
                key={p.name}
                href={p.href}
                target={p.external ? "_blank" : undefined}
                rel={p.external ? "noreferrer" : undefined}
                className="block transition-transform hover:-translate-y-0.5"
              >
                {card}
              </a>
            ) : (
              <div key={p.name}>{card}</div>
            );
          })}
        </div>
      </section>

      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} INTEL.DOM.GOB — Estado Dominicano.
          </span>
          <span>
            Proyecto de{" "}
            <a
              href="https://www.agentix.com.do/"
              target="_blank"
              rel="noreferrer"
              className="underline transition-colors hover:text-foreground"
            >
              Agentix
            </a>
            .
          </span>
        </div>
      </footer>
    </main>
  );
}

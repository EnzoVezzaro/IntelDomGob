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
    href: "/docs",
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

const PRODUCTS_EN: Product[] = [
  {
    name: "API",
    tagline: "Government API",
    description:
      "The API-first entry point for the entire platform. Every capability is exposed via HTTP and an MCP server. Use it to build on INTEL.DOM.GOB.",
    status: "live",
    badge: "api.intel.dom.gob",
    href: "https://api.intel.dom.gob/docs",
    external: true,
  },
  {
    name: "Studio",
    tagline: "IntelDomGob Studio",
    description:
      "Multi-agent workspace (AGPL-3.0 fork of Odysseus) that connects to the platform only via the MCP server. Chat, agents, research and more.",
    status: "live",
    badge: "studio.intel.dom.gob",
    href: "https://studio.intel.dom.gob",
    external: true,
  },
  {
    name: "MCP",
    tagline: "MCP Server",
    description:
      "Model Context Protocol surface (Streamable HTTP + SSE). Studio, CLI and any standard MCP client connect equally.",
    status: "live",
    badge: "mcp.intel.dom.gob/mcp",
    href: "https://mcp.intel.dom.gob/health",
    external: true,
  },
  {
    name: "Web",
    tagline: "Public website",
    description:
      "Our public website (SDK only): product page + live demo that queries official sources without installing anything. Works without account or API key.",
    status: "live",
    href: "https://web.intel.dom.gob",
    external: true,
  },
  {
    name: "CLI",
    tagline: "Terminal client",
    description:
      "Interactive terminal client (OpenCode style) that connects via MCP. For developers and automation.",
    status: "live",
    badge: "npm: @intel.dom.gob/app-cli",
    href: "/en/docs",
  },
  {
    name: "Docs",
    tagline: "Project documentation",
    description:
      "Documentation for all products: architecture, providers, services, API, deployment and development.",
    status: "live",
    href: "/en/docs/",
  },
];

const TEXTS = {
  es: {
    docs: "Documentación",
    platform: "Plataforma de Inteligencia Gubernamental",
    title: "INTEL.DOM.GOB",
    subtitle: "Plataforma de Inteligencia Gubernamental del Estado Dominicano",
    description:
      "API-first, multi-agente, basada en evidencia oficial. Documentación de todos los productos en un solo lugar.",
    cta: "Ver documentación",
    products: "Productos",
    productsDesc: "INTEL.DOM.GOB es un ecosistema de productos. Esta documentación cubre todos ellos.",
    live: "En vivo",
    soon: "Próximamente",
    footer: "Estado Dominicano.",
    project: "Proyecto de",
  },
  en: {
    docs: "Documentation",
    platform: "Government Intelligence Platform",
    title: "INTEL.DOM.GOB",
    subtitle: "Dominican Government Intelligence Platform",
    description:
      "API-first, multi-agent, evidence-based. Documentation for all products in one place.",
    cta: "View documentation",
    products: "Products",
    productsDesc: "INTEL.DOM.GOB is an ecosystem of products. This documentation covers all of them.",
    live: "Live",
    soon: "Coming Soon",
    footer: "Dominican Republic.",
    project: "Project by",
  },
};

export default function HomePage() {
  const t = TEXTS.es;
  const products = PRODUCTS;

  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold">
            <pre className="ascii mini" aria-hidden="true">
{` ██╗███╗    ████╗   
 ██║   ██╗██║   ██╗
 ██║   ██║██║   ██║
 ██║   ██║██║   ██║
 ██████║    ████║  
 ╚═════╝    ╚═══╝  `}
            </pre>
            <span>INTEL.DOM.GOB</span>
          </div>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/docs/" className="transition-colors hover:text-foreground">
              {t.docs}
            </Link>
            <Link href="/en/docs/" className="transition-colors hover:text-foreground">
              EN
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
          {t.platform}
        </span>
        <h1 className="mb-5 max-w-3xl text-5xl font-bold tracking-tight">
          {t.title}
        </h1>
        <p className="mb-3 max-w-2xl text-xl text-muted-foreground">
          {t.subtitle}
         </p>
        <p className="mb-10 max-w-2xl text-muted-foreground">
          {t.description}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/docs/"
            className="inline-flex h-11 items-center rounded-lg bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t.cta}
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <h2 className="mb-2 text-lg font-semibold">{t.products}</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {t.productsDesc}
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const card = (
              <div className="flex h-full flex-col rounded-xl border border-border bg-card p-6 text-card-foreground">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  {p.status === "live" ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t.live}
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t.soon}
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
            © {new Date().getFullYear()} INTEL.DOM.GOB — {t.footer}
          </span>
          <span>
            {t.project}{" "}
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

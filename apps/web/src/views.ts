// apps/web — server-rendered HTML templates for the public site.
import type { IntelligenceResult } from "@intel.dom.gob/sdk/types";

export interface DemoPayload {
  ok: boolean;
  query?: string;
  summary?: string;
  confidence?: string;
  institution?: string;
  sources?: { title?: string; url: string }[];
  error?: string;
}

const ICON: Record<string, string> = {
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  db: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  scale: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0L7 7m10 0-3 7a3 3 0 0 0 6 0l-3-7"/></svg>',
  code: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg>',
  terminal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 5 7 7-7 7M13 19h7"/></svg>',
  globe: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  box: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  plug: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6"/></svg>',
  github: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.04 10.04 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>',
  book: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 5.5V21"/></svg>',
  mail: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
  quote: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" opacity="0.25"><path d="M7 7h4v4H8v2h5V7h-4V5H7zm8 0h4v4h-3v2h5V7h-4V5h-2z"/></svg>',
};

const SRC_ICON =
  '<svg class="src-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';

export function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Hero ASCII animation frames — all 38 cols × 6 rows, same-grid layout.
const ASCII_FRAMES: string[][] = [
  // 0 — INTEL.DOM.GOB logo
  [
    " ██╗███╗   ██╗████████╗███████╗██╗    ",
    " ██║████╗  ██║╚══██╔══╝██╔════╝██║    ",
    " ██║██╔██╗ ██║   ██║   █████╗  ██║    ",
    " ██║██║╚██╗██║   ██║   ██╔══╝  ██║    ",
    " ██║██║ ╚████║   ██║   ███████╗██████╗",
    " ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═════╝",
  ],
  // 1 — Eye (inner field is uniform ░; the iris ████ is placed by JS at runtime)
  [
    "                                      ",
    "  ╭───────────────────────────────╮   ",
    "  │░░░░░░░░░░░░░░████░░░░░░░░░░░░░│   ",
    "  │░░░░░░░░░░░░░░████░░░░░░░░░░░░░│   ",
    "  ╰───────────────────────────────╯   ",
    "                                      ",
  ],
  // 2 — Government dome
  [
    "            ╭──────────╮              ",
    "         ╔═══════════════╗            ",
    "       ╔╧╧╧╧╧╧╧╧╧╧╧╧╧╧╧╧═╗            ",
    "       ║█▌║█▌║█▌║█▌║█▌║█▌║            ",
    "     ╔═╧╧╧╧╧╧╧╧╧╧╧╧╧╧╧╧╧╧╧═╗          ",
    "     ╚═══════════════════════╝        ",
  ],
];

const ASCII = `<pre class="ascii" data-ascii-canvas aria-hidden="true">${ASCII_FRAMES[0].join("\n")}</pre>`;


const MARK_ASCII = `<pre class="ascii mini" aria-hidden="true"> ██╗███╗    ████╗   
 ██║   ██╗██║   ██╗
 ██║   ██║██║   ██║
 ██║   ██║██║   ██║
 ██████║    ████║  
 ╚═════╝    ╚═══╝  </pre>`;


function nav(): string {
  return `
  <header class="nav">
    <div class="nav-inner">
      <a class="brand" href="#top" aria-label="INTEL.DOM.GOB">
        ${MARK_ASCII}
        <span class="name">INTEL<span>.DOM.GOB</span></span>
      </a>
      <nav class="nav-links" aria-label="Principal">
        <a href="#inicio">Elígelo</a>
        <a href="#demo">Pruébalo</a>
        <a href="#producto">Producto</a>
        <a href="#ecosistema">Ecosistema</a>
        <a href="#testimonios">Quienes</a>
        <a href="#precios">Precios</a>
        <a href="https://docs.intel.dom.gob" target="_blank" rel="noopener">Documentación</a>
      </nav>
      <div class="nav-right">
        <a class="nav-icon" href="https://github.com/EnzoVezzaro/IntelDomGob" target="_blank" rel="noopener" aria-label="GitHub">${ICON.github}</a>
        <a class="btn btn-primary btn-sm" href="https://studio.intel.dom.gob" target="_blank" rel="noopener">Abrir Studio</a>
        <button class="nav-toggle" aria-label="Menú" data-nav-toggle>
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <div class="nav-mobile" data-nav-mobile>
      <a href="#inicio">Elígelo</a>
      <a href="#demo">Pruébalo</a>
      <a href="#producto">Producto</a>
      <a href="#ecosistema">Ecosistema</a>
      <a href="#testimonios">Quienes</a>
      <a href="#precios">Precios</a>
      <a href="https://docs.intel.dom.gob" target="_blank" rel="noopener">Documentación</a>
    </div>
  </header>`;
}

function hero(): string {
  return `
  <section class="hero" id="top">
    <div class="wrap center">
      ${ASCII}
      <script type="application/json" id="asciiFrames">${JSON.stringify(ASCII_FRAMES)}</script>
      <span class="eyebrow">Open source · Datos del Estado Dominicano</span>
      <h1>La inteligencia del <em>Estado Dominicano</em>, en tiempo real.</h1>
      <p class="lead">Un orquestador multi-agente que investiga sobre fuentes oficiales — Senado, Cámara de Diputados, Presidencia, Tribunal Constitucional — y responde con evidencia, no con alucinaciones. Sin API key para el modo público.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#demo">Empezar a consultar</a>
        <a class="btn btn-ghost" href="https://docs.intel.dom.gob" target="_blank" rel="noopener">Ver documentación</a>
      </div>
      <div class="hero-note"><span class="dot"></span> Modo público: 20 consultas/día, sin registro ni tarjeta.</div>
    </div>
  </section>`;
}

function quickStart(): string {
  // Surfaces: image-led (Studio, CLI) vs code-mockup-led (API, MCP, SDK).
  // API is "próximamente" → greyed out, not selectable as the active tab.
  const cards = [
    {
      id: "studio",
      kind: "image",
      title: "Studio",
      tag: "Workspace multi-agente",
      desc: "Fork AGPL-3.0 de Odysseus. Se conecta a la plataforma sólo vía MCP.",
      img: "/assets/img/studio.png",
      href: "https://studio.intel.dom.gob",
      cta: "Abrir Studio",
      copy: "docker compose up -d --build",
      code: `<span class="c"># Studio: workspace multi-agente (fork AGPL-3.0 de Odysseus)</span>
<span class="k">git clone</span> https://github.com/EnzoVezzaro/IntelDomGob.git
<span class="k">cd</span> IntelDomGob && <span class="k">cp</span> .env.example .env
<span class="k">docker compose up</span> -d --build
<span class="c"># Abre http://studio.localhost — se conecta vía MCP</span>`,
    },
    {
      id: "cli",
      kind: "image",
      title: "CLI",
      tag: "Terminal interactivo",
      desc: "Linux/macOS/Windows. Estilo OpenCode, conversa con el orquestador.",
      img: "/assets/img/cli.png",
      href: "https://github.com/EnzoVezzaro/IntelDomGob/tree/main/apps/cli",
      cta: "Ver CLI",
      copy: "npm run dev --workspace=apps/cli",
      code: `<span class="c"># CLI: terminal interactivo (estilo OpenCode), vía MCP</span>
<span class="k">npm run dev</span> --workspace=apps/cli
<span class="c"># o en modo una-línea:</span>
<span class="k">intel</span> -p <span class="s">"¿Iniciativas recientes del Senado?"</span>`,
    },
    {
      id: "mcp",
      kind: "mockup",
      title: "MCP",
      tag: "Model Context Protocol",
      desc: "Streamable HTTP + SSE. Conéctalo desde Claude, cursor, Studio.",
      mockup: "mcp",
      href: "https://mcp.intel.dom.gob/health",
      cta: "Conectar",
      copy: "docker compose up -d",
      code: `<span class="c"># MCP: servidor Model Context Protocol (Streamable HTTP + SSE)</span>
<span class="k">docker compose up</span> -d   <span class="c"># expone mcp:4100/mcp</span>

<span class="c"># Conéctalo desde cualquier cliente MCP (Claude, Studio, cursor…):</span>
{
  <span class="s">"mcpServers"</span>: {
    <span class="s">"intel-dom-gob"</span>: { <span class="s">"url"</span>: <span class="s">"https://mcp.intel.dom.gob/mcp"</span> }
  }
}`,
    },
    {
      id: "sdk",
      kind: "mockup",
      title: "SDK",
      tag: "TypeScript · ESM",
      desc: "El único cliente para hablar con la API. Úsalo desde tu app o scripts.",
      mockup: "sdk",
      href: "https://docs.intel.dom.gob/docs/sdk-reference",
      cta: "Referencia SDK",
      copy: "npm install @intel.dom.gob/sdk",
      code: `<span class="c">// Conéctala a tu app, o úsala desde Studio / MCP / CLI.</span>
<span class="k">import</span> { createClient } <span class="k">from</span> <span class="s">"@intel.dom.gob/sdk"</span>;
<span class="k">const</span> client = <span class="k">createClient</span>({ baseUrl: <span class="s">"https://api.intel.dom.gob"</span> });
<span class="k">const</span> r = <span class="k">await</span> client.<span class="k">query</span>({ query: <span class="s">"¿Leyes de energía 2026?"</span> });
console.<span class="k">log</span>(r.response.summary); <span class="c">// con fuentes</span>`,
    },
    {
      id: "api",
      kind: "mockup",
      title: "API",
      tag: "Próximamente",
      soon: true,
      desc: "REST + SSE ya expuesto internamente. El panel público viene pronto.",
      mockup: "api",
      href: "https://docs.intel.dom.gob",
      cta: "Ver documentación",
      copy: "",
      code: `<span class="c">// API REST + SSE — panel público próximamente.</span>
<span class="c">// Hoy ya alimentan todas las superficies:</span>
<span class="k">const</span> r = <span class="k">await</span> fetch(<span class="s">"https://api.intel.dom.gob/v1/query"</span>, {
  method: <span class="s">"POST"</span>,
  headers: { <span class="s">"Content-Type"</span>: <span class="s">"application/json"</span> },
  body: JSON.stringify({ query: <span class="s">"¿Sesiones del Senado?"</span> }),
});`,
    },
  ];

  const mockups: Record<string, string> = {
    mcp: `<div class="mockwin">
  <div class="mockbar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="mockpath">mcp.intel.dom.gob/mcp</span></div>
  <div class="mockbody">
    <div class="mockline"><span class="mtok k">POST</span> <span class="mtok p">/mcp</span></div>
    <div class="mockline"><span class="mtok c">Content-Type:</span> <span class="mtok s">application/json</span></div>
    <div class="mockline">&nbsp;</div>
    <div class="mockline"><span class="mtok c">{</span></div>
    <div class="mockline">&nbsp;&nbsp;<span class="mtok s">"jsonrpc"</span>: <span class="mtok s">"2.0"</span>,</div>
    <div class="mockline">&nbsp;&nbsp;<span class="mtok s">"method"</span>: <span class="mtok s">"tools/call"</span>,</div>
    <div class="mockline">&nbsp;&nbsp;<span class="mtok s">"params"</span>: { <span class="mtok s">"name"</span>: <span class="mtok s">"intel_query"</span>,</div>
    <div class="mockline">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="mtok s">"arguments"</span>: { <span class="mtok s">"q"</span>: <span class="mtok s">"…"</span> } }</div>
    <div class="mockline"><span class="mtok c">}</span></div>
  </div>
</div>`,
    sdk: `<div class="mockwin">
  <div class="mockbar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="mockpath">query.ts</span></div>
  <div class="mockbody">
    <div class="mockline"><span class="mtok k">import</span> { createClient } <span class="mtok k">from</span> <span class="mtok s">"@intel.dom.gob/sdk"</span>;</div>
    <div class="mockline">&nbsp;</div>
    <div class="mockline"><span class="mtok k">const</span> client = <span class="mtok k">createClient</span>({</div>
    <div class="mockline">&nbsp;&nbsp;baseUrl: <span class="mtok s">"https://api.intel.dom.gob"</span></div>
    <div class="mockline">});</div>
    <div class="mockline">&nbsp;</div>
    <div class="mockline"><span class="mtok k">const</span> r = <span class="mtok k">await</span> client.<span class="mtok k">query</span>({</div>
    <div class="mockline">&nbsp;&nbsp;query: <span class="mtok s">"¿Leyes de energía 2026?"</span></div>
    <div class="mockline">});</div>
    <div class="mockline">&nbsp;</div>
    <div class="mockline">console.<span class="mtok k">log</span>(r.response.summary); <span class="mtok c">// con fuentes</span></div>
  </div>
</div>`,
    api: `<div class="mockwin">
  <div class="mockbar"><span class="d r"></span><span class="d y"></span><span class="d g"></span><span class="mockpath">api.intel.dom.gob/v1/query</span></div>
  <div class="mockbody">
    <div class="mockline"><span class="mtok k">POST</span> <span class="mtok p">/v1/query</span>&nbsp;&nbsp;<span class="mtok c">200 OK</span></div>
    <div class="mockline"><span class="mtok k">↑</span> { <span class="mtok s">"query"</span>: <span class="mtok s">"…"</span> }</div>
    <div class="mockline"><span class="mtok k">↓</span> text/event-stream · SSE</div>
    <div class="mockline">&nbsp;</div>
    <div class="mockline"><span class="mtok c">event: summary</span></div>
    <div class="mockline"><span class="mtok c">data:</span> <span class="mtok s">{ "sources": [...] }</span></div>
    <div class="mockline"><span class="mtok c">event: done</span></div>
  </div>
</div>`,
  };

  const card = (c: typeof cards[number]) => {
    const soon = !!c.soon;
    const visual = c.kind === "image"
      ? `<div class="surf-shot${soon ? " soon" : ""}">
           <img src="${c.img}" alt="Captura de ${c.title}" loading="lazy" />
           ${soon ? '<span class="soon-badge">Próximamente</span>' : ""}
         </div>`
      : `<div class="surf-mock${soon ? " soon" : ""}">
           ${mockups[c.mockup as string] || ""}
           ${soon ? '<span class="soon-badge">Próximamente</span>' : ""}
         </div>`;
    return `
    <button class="surface${soon ? " soon" : ""}" data-surface="${c.id}"${soon ? " disabled aria-disabled=\"true\"" : ""}>
      ${visual}
      <div class="surf-meta">
        <span class="surf-tag">${c.tag}</span>
        <h3>${c.title}</h3>
        <p>${c.desc}</p>
        <span class="surf-cta">${c.cta} ${ICON.arrow}</span>
      </div>
    </button>`;
  };

  const panel = (c: typeof cards[number]) => {
    if (c.soon || !c.code) return "";
    return `
    <div class="qs-panel" data-qs-panel="${c.id}">
      <div class="qs-panel-head">
        <div><b>${c.title}</b> · <span class="mono">${c.copy || ""}</span></div>
        ${c.href ? `<a class="qs-open" href="${c.href}" target="_blank" rel="noopener">Abrir ${ICON.arrow}</a>` : ""}
      </div>
      <div class="code">
        ${c.copy ? `<button class="copy" data-copy="${esc(c.copy)}">Copiar</button>` : ""}
        <pre>${c.code}</pre>
      </div>
    </div>`;
  };

  return `
  <section id="inicio">
    <div class="wrap">
      <span class="eyebrow">Cómo empezar</span>
      <h2 class="section-title">Elígelo tu forma de usarla.</h2>
      <p class="section-sub">Escritorio, terminal, protocolo o tu propia app — cada superficie habla con la misma plataforma.</p>
      <div class="surfaces" style="margin-top:40px">
        ${cards.map(card).join("")}
      </div>
      <div class="qs-panels" data-qs-panels>
        ${cards.map(panel).join("")}
      </div>
      <p class="center muted" style="margin-top:18px;font-size:13px">Toca una superficie para ver el código de arranque.</p>
    </div>
  </section>`;
}

function testimonials(): string {
  const rows = [
    [
      { r: "Analista de políticas públicas", c: "Santo Domingo", q: "Seguir las iniciativas del Senado me tomaba horas en la web del Congreso. Ahora pregunto y me trae las fuentes." },
      { r: "Periodista investigativo", c: "Santiago", q: "El rastro de fuentes es oro para verificar antes de publicar. Nada de respuestas voladas." },
      { r: "Desarrollador cívico", c: "RD", q: "El SDK es limpio. Lo conecté a un bot de Telegram en una tarde." },
      { r: "Investigadora universitaria", c: "Santo Domingo", q: "Uso los datos del SIL para mis clases de derecho constitucional. Siempre actualizado." },
    ],
    [
      { r: "Abogado regulario", c: "RD", q: "Due diligence de marcos legales en minutos, con los artículos citados." },
      { r: "Funcionario de DGCP", c: "RD", q: "Por fin una forma de que la ciudadanía consulte contratos públicos sin saber SQL." },
      { r: "Estudiante de periodismo", c: "RD", q: "Mi TFG sobre transparencia legislativa fue mucho más fácil con esto." },
      { r: "ONG de transparencia", c: "RD", q: "Monitoreamos sesiones de la Cámara en tiempo real. El modo público es perfecto para nosotros." },
    ],
  ];
  const card = (t: { r: string; c: string; q: string }) => `
    <figure class="tcard">
      <div class="tcard-q">${ICON.quote}<p>${esc(t.q)}</p></div>
      <figcaption><span class="tavatar">${esc(t.r.split(" ")[0][0] + (t.r.split(" ")[1] ? t.r.split(" ")[1][0] : ""))}</span><span><b>${esc(t.r)}</b><small>${esc(t.c)}</small></span></figcaption>
    </figure>`;
  return `
  <section class="alt" id="testimonios">
    <div class="wrap center">
      <span class="eyebrow">Lo que dicen</span>
      <h2 class="section-title">Quienes lo usan, investigan mejor.</h2>
    </div>
    <div class="marquee" data-marquee>
      <div class="marquee-track">${rows[0].map(card).join("")}${rows[0].map(card).join("")}</div>
    </div>
    <div class="marquee" data-marquee>
      <div class="marquee-track rev">${rows[1].map(card).join("")}${rows[1].map(card).join("")}</div>
    </div>
    <p class="marquee-note">Testimonios ilustrativos — reemplázalos por casos reales.</p>
  </section>`;
}

function resources(): string {
  return `
  <section id="recursos">
    <div class="wrap">
      <span class="eyebrow">Recursos</span>
      <h2 class="section-title">Empieza por la documentación.</h2>
      <div class="res-grid">
        <a class="res-feature" href="https://docs.intel.dom.gob/docs/products" target="_blank" rel="noopener">
          <span class="tag">Guía</span>
          <h3>Productos de INTEL.DOM.GOB</h3>
          <p>Studio, API, MCP, CLI y Admin: qué es cada uno y cómo se autentican.</p>
          <span class="access-link">Leer ${ICON.arrow}</span>
        </a>
        <div class="res-list">
          <a href="https://docs.intel.dom.gob/docs/getting-started" target="_blank" rel="noopener"><b>Empezar</b><small>Despliega en tu máquina en 10 minutos.</small></a>
          <a href="https://docs.intel.dom.gob/docs/sdk-reference" target="_blank" rel="noopener"><b>Referencia del SDK</b><small>Cliente TypeScript para consultar la plataforma.</small></a>
        </div>
      </div>
    </div>
  </section>`;
}

function features(): string {
  const items = [
    { ico: ICON.bolt, t: "Investigación multi-agente", d: "Un orquestador planifica, busca, lee y contrasta fuentes antes de responder." },
    { ico: ICON.db, t: "Fuentes oficiales del Estado", d: "Senado, Cámara, Presidencia, Tribunal Constitucional, DGCP y Datos Abiertos." },
    { ico: ICON.scale, t: "Datos legislativos (SIL)", d: "Iniciativas, comisiones, sesiones y resoluciones de Cámara y Senado en tiempo real." },
    { ico: ICON.check, t: "Respuestas con fuentes", d: "Cada afirmación lleva su evidencia. No alucina: todo es rastreable." },
    { ico: ICON.code, t: "Acceso vía SDK, MCP, CLI, Studio", d: "REST versionada + SSE y compatible con clientes MCP. Conecta como quieras." },
    { ico: ICON.lock, t: "Modo público sin API key", d: "20 consultas/día, sin registro. Sube de plan cuando lo necesites." },
  ];
  return `
  <section class="alt" id="producto">
    <div class="wrap">
      <span class="eyebrow">Qué hace</span>
      <h2 class="section-title">Inteligencia del Estado, al alcance de todos.</h2>
      <div class="grid grid-3">
        ${items.map((i) => `
          <div class="card">
            <div class="ico">${i.ico}</div>
            <h3>${i.t}</h3>
            <p>${i.d}</p>
          </div>`).join("")}
      </div>
    </div>
  </section>`;
}

function showcase(): string {
  const items = [
    { pill: "Congreso", t: "Seguimiento legislativo", d: "Alerta y resume iniciativas, comisiones y sesiones de Cámara y Senado." },
    { pill: "Medios", t: "Periodismo de investigación", d: "Verifica afirmaciones contra fuentes oficiales con un rastro de evidencia." },
    { pill: "Empresas", t: "Due diligence regulatoria", d: "Cruza marcos legales y contratos públicos antes de una operación." },
    { pill: "Educación", t: "Educación cívica", d: "Lleva el Congreso al aula con datos actualizados y citables." },
  ];
  return `
  <section class="alt" id="ecosistema">
    <div class="wrap">
      <span class="eyebrow">Casos de uso</span>
      <h2 class="section-title">Lo que puedes construir.</h2>
      <div class="grid grid-2">
        ${items.map((i) => `
          <div class="card show">
            <span class="pill">${i.pill}</span>
            <h3>${i.t}</h3>
            <p>${i.d}</p>
            <a class="access-link" href="#demo">Probar ahora ${ICON.arrow}</a>
          </div>`).join("")}
      </div>
    </div>
  </section>`;
}

function pricing(): string {
  const tiers = [
    { n: "Público", p: "Gratis", sub: "/siempre", d: "Para explorar. Sin registro, sin tarjeta.", feats: ["20 consultas/día", "Sin API key", "Fuentes oficiales", "Studio + búsqueda"], cta: "Empezar", href: "#demo", feat: false },
    { n: "Investigador", p: "Gratis", sub: "/ .gob.do", d: "Para investigadores y sector público.", feats: ["200 consultas/día", "Sin costo para .gob.do", "SDK + MCP", "Sin límite de fuentes"], cta: "Solicitar", href: "https://admin.intel.dom.gob", feat: true },
    { n: "Pro", p: "Desde $", sub: "/mes", d: "Para equipos e integraciones.", feats: ["1000+ consultas/día", "API key propia", "Límites a medida", "Soporte prioritario"], cta: "Contactar", href: "https://admin.intel.dom.gob", feat: false },
    { n: "Institucional", p: "A medida", sub: "", d: "Para organismos del Estado.", feats: ["Cuotas por contrato", "Tenant dedicado", "RBAC/ABAC", "Despliegue propio"], cta: "Hablar", href: "https://admin.intel.dom.gob", feat: false },
  ];
  return `
  <section id="precios">
    <div class="wrap">
      <span class="eyebrow">Planes</span>
      <h2 class="section-title">Empieza gratis. Crece cuando lo necesites.</h2>
      <div class="price-grid">
        ${tiers.map((t) => `
          <div class="price${t.feat ? " feature" : ""}">
            <div class="pname">${t.n}</div>
            <div class="pprice">${t.p}<small> ${t.sub}</small></div>
            <div class="pdesc">${t.d}</div>
            <ul>${t.feats.map((f) => `<li>${ICON.check}${f}</li>`).join("")}</ul>
            <a class="btn ${t.feat ? "btn-primary" : "btn-ghost"}" href="${t.href}" target="_blank" rel="noopener">${t.cta}</a>
          </div>`).join("")}
      </div>
      <p class="center muted" style="margin-top:22px">Datos públicos en bruto (instituciones, SIL legislativo, lectura del grafo de conocimiento) son siempre gratuitos.</p>
    </div>
  </section>`;
}

function demoSection(instCount: number): string {
  return `
  <section id="demo">
    <div class="wrap center">
      <span class="eyebrow">Pruébalo ahora</span>
      <h2 class="section-title">Haz tu primera consulta.</h2>
      <p class="section-sub">Sin API key. Pregunta lo que sea sobre el Estado Dominicano y mira las fuentes oficiales.</p>
      <form class="demo-card" data-demo-form>
        <input type="text" name="q" placeholder="¿Cuáles son las iniciativas del Senado esta semana?" aria-label="Consulta" />
        <button class="btn btn-primary btn-sm" type="submit">Consultar</button>
      </form>
      <div class="demo-result" data-demo-result></div>
      <p class="demo-alt">O usa el modo sin JS: <a href="/buscar?q=iniciativas%20del%20Senado">/buscar?q=…</a></p>
      <p class="muted" style="margin-top:14px;font-size:13px">${instCount} fuentes oficiales conectadas en vivo.</p>
    </div>
  </section>`;
}

function footerCtas(): string {
  const items = [
    { ico: ICON.terminal, t: "Studio", l: "https://studio.intel.dom.gob" },
    { ico: ICON.book, t: "Documentación", l: "https://docs.intel.dom.gob" },
    { ico: ICON.github, t: "GitHub", l: "https://github.com/EnzoVezzaro/IntelDomGob" },
    { ico: ICON.lock, t: "Admin", l: "https://admin.intel.dom.gob" },
  ];
  return `
  <section class="alt center" id="comunidad">
    <div class="wrap">
      <div class="grid grid-4">
        ${items.map((i) => `
          <a class="fcta" href="${i.l}" target="_blank" rel="noopener">
            <span class="fcta-ico">${i.ico}</span>
            <span>${i.t}</span>
            ${ICON.arrow}
          </a>`).join("")}
      </div>
    </div>
  </section>`;
}

function newsletter(): string {
  return `
  <section id="novedades" class="center">
    <div class="wrap narrow">
      <span class="eyebrow">Novedades</span>
      <h2 class="section-title">Recibe actualizaciones del proyecto.</h2>
      <p class="section-sub">Nuevas fuentes oficiales, mejoras del orquestador y casos de uso. Sin spam.</p>
      <form class="news" data-news>
        <input type="email" name="email" placeholder="tu@correo.gob.do" aria-label="Correo" required />
        <button class="btn btn-primary" type="submit">Suscribirme</button>
      </form>
      <p class="news-ok" data-news-ok hidden>¡Gracias! Te avisaremos cuando haya novedades.</p>
    </div>
  </section>`;
}

function techRow(): string {
  const tech = ["Node.js", "PostgreSQL", "DragonflyDB", "Caddy", "SearXNG", "Gemini"];
  return `
  <section class="tech center">
    <div class="wrap">
      <span class="eyebrow">Construido con</span>
      <div class="tech-row">${tech.map((t) => `<span class="tech-logo">${t}</span>`).join("")}</div>
    </div>
  </section>`;
}

function footer(): string {
  return `
  <footer>
    <div class="wrap">
      <div class="foot-grid">
        <div class="foot-brand">
          <a class="brand" href="#top">${MARK_ASCII}<span class="name">INTEL<span>.DOM.GOB</span></span></a>
          <p class="muted" style="margin-top:14px;max-width:280px;font-size:14px">Inteligencia abierta del Estado Dominicano. Código abierto, datos oficiales.</p>
          <div class="foot-social">
            <a href="https://github.com/EnzoVezzaro/IntelDomGob" target="_blank" rel="noopener" aria-label="GitHub">${ICON.github}</a>
            <a href="https://docs.intel.dom.gob" target="_blank" rel="noopener" aria-label="Documentación">${ICON.book}</a>
            <a href="https://studio.intel.dom.gob" target="_blank" rel="noopener" aria-label="Studio">${ICON.terminal}</a>
          </div>
        </div>
        <div class="foot-cols">
          <div class="foot-col">
            <h5>Producto</h5>
            <a href="#producto">Qué hace</a>
            <a href="#precios">Planes</a>
            <a href="#demo">Demo</a>
            <a href="https://studio.intel.dom.gob" target="_blank" rel="noopener">Studio</a>
          </div>
          <div class="foot-col">
            <h5>Recursos</h5>
            <a href="https://docs.intel.dom.gob/docs/getting-started" target="_blank" rel="noopener">Empezar</a>
            <a href="https://docs.intel.dom.gob/docs/sdk-reference" target="_blank" rel="noopener">SDK</a>
            <a href="https://docs.intel.dom.gob/docs/products" target="_blank" rel="noopener">Superficies</a>
          </div>
          <div class="foot-col">
            <h5>Proyecto</h5>
            <a href="https://github.com/EnzoVezzaro/IntelDomGob" target="_blank" rel="noopener">GitHub</a>
            <a href="https://github.com/EnzoVezzaro/IntelDomGob/blob/main/LICENSE" target="_blank" rel="noopener">Licencia</a>
            <a href="#novedades">Novedades</a>
          </div>
        </div>
      </div>
      <div class="foot-bottom">
        <span>© ${new Date().getFullYear()} INTEL.DOM.GOB — plataforma MIT · Studio AGPL-3.0.</span>
        <span class="mono">Studio · CLI · MCP · SDK · API</span>
      </div>
    </div>
  </footer>`;
}

export function home(instCount: number): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>INTEL.DOM.GOB — Inteligencia del Estado Dominicano</title>
  <meta name="description" content="Plataforma de inteligencia artificial del Estado Dominicano. Orquestador multi-agente sobre fuentes oficiales, con evidencia y sin alucinaciones." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="bg-glow"></div>
  <div class="content" id="top">
    ${nav()}
    <main>
      ${hero()}
      ${quickStart()}
      ${demoSection(instCount)}
      ${testimonials()}
      ${resources()}
      ${features()}
      ${showcase()}
      ${pricing()}
      ${footerCtas()}
      ${newsletter()}
    </main>
    ${techRow()}
    ${footer()}
  </div>
  <button class="to-top" data-to-top aria-label="Volver arriba" hidden>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>
  </button>
  <script src="/app.js"></script>
</body>
</html>`;
}

export function resultsView(p: DemoPayload): string {
  const src = (p.sources || []).map((s) => `
    <a class="rsrc" href="${esc(s.url)}" target="_blank" rel="noopener">${SRC_ICON}<span>${esc(s.title || s.url)}</span></a>`).join("");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(p.query || "Resultado")} — INTEL.DOM.GOB</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="bg-glow"></div>
  <div class="content">
    <main class="result-page">
      <div class="wrap">
        <a class="back-link" href="/">${ICON.arrow} Volver</a>
        <div class="result-head">
          <h1>${esc(p.query || "")}</h1>
        </div>
        ${p.ok
          ? `<div class="demo-meta">
               <span class="chip">Confianza: <b class="conf">${esc(p.confidence)}</b></span>
               <span class="chip">${esc(p.institution || "Estado Dominicano")}</span>
             </div>
             <div class="demo-summary">${esc(p.summary)}</div>
             ${src ? `<div class="demo-sources"><h4>Fuentes oficiales</h4>${src}</div>` : ""}`
          : `<div class="demo-error">⚠ ${esc(p.error)}</div>`}
        <p class="muted" style="margin-top:24px"><a class="access-link" href="/#demo">Hacer otra consulta ${ICON.arrow}</a></p>
      </div>
    </main>
  </div>
</body>
</html>`;
}

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <div className="mb-6 flex justify-center">
          <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl">
            ID
          </div>
        </div>
        <h1 className="mb-4 text-4xl font-bold tracking-tight">
          INTEL.DOM.GOB
        </h1>
        <p className="mb-2 text-xl text-muted-foreground">
          Plataforma de Inteligencia Gubernamental del Estado Dominicano
        </p>
        <p className="mb-8 text-muted-foreground">
          API-first, multi-agente, basada en evidencia oficial.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/docs/"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Documentation
          </Link>
          <a
            href="https://github.com/intel-dom-gob/intel.dom.gob"
            className="inline-flex h-10 items-center rounded-lg border border-input bg-background px-8 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </main>
  );
}

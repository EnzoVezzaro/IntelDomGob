import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h2 className="text-2xl font-bold">404 — Página no encontrada</h2>
      <p className="text-muted-foreground">La página que buscas no existe.</p>
      <Link href="/docs/" className="text-primary underline">
        Ir a la documentación
      </Link>
    </div>
  );
}

"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Algo salió mal</h2>
          <p>{error.message}</p>
          <button onClick={() => reset()}>Intentar de nuevo</button>
        </div>
      </body>
    </html>
  );
}

import "./global.css";
import Provider from "./providers";
import type { ReactNode } from "react";

export const metadata = {
  title: {
    default: "INTEL.DOM.GOB",
    template: "%s | INTEL.DOM.GOB",
  },
  description:
    "Plataforma de Inteligencia Gubernamental del Estado Dominicano — API-first, multi-agente, basada en evidencia oficial.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}

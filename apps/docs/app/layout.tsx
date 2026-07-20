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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}

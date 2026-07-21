"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function Provider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locale = pathname.startsWith("/en") ? "en" : "es";

  return (
    <RootProvider
      search={{ options: { api: `/api/search?locale=${locale}` } }}
      theme={{ defaultTheme: "dark", enableSystem: false, attribute: "class" }}
    >
      {children}
    </RootProvider>
  );
}

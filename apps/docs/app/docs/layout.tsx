import { sources } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import RootLayout from "../layout";
import { LanguageSwitcher } from "../components/language-switcher";

const NAV_LINKS = [
  { text: "Studio", url: "https://studio.intel.dom.gob" },
  { text: "API", url: "https://api.intel.dom.gob/docs" },
  { text: "Web", url: "https://web.intel.dom.gob" },
  { text: "Admin", url: "https://admin.intel.dom.gob" },
  { text: "MCP", url: "https://mcp.intel.dom.gob/health" },
  { text: "Docs", url: "/docs" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootLayout>
      <DocsLayout
        tree={(sources as any).es.pageTree}
        nav={{
          title: "INTEL.DOM.GOB",
          url: "/",
          children: <LanguageSwitcher locale="es" />,
        }}
        links={NAV_LINKS}
        themeSwitch={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </RootLayout>
  );
}

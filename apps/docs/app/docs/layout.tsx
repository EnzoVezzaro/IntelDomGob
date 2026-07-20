import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import RootLayout from "../layout";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootLayout>
      <DocsLayout tree={(source as any).pageTree}>
        {children}
      </DocsLayout>
    </RootLayout>
  );
}

"use client";

import { usePathname } from "next/navigation";

export function LanguageSwitcher({ locale }: { locale: string }) {
  const pathname = usePathname();

  function getLocaleUrl(targetLocale: string): string {
    if (targetLocale === locale) return pathname;

    if (targetLocale === "es") {
      return pathname.replace(/^\/en(?=\/|$)/, "") || "/docs";
    }

    if (targetLocale === "en") {
      if (pathname.startsWith("/en/")) return pathname;
      return "/en" + (pathname.startsWith("/") ? pathname : "/" + pathname);
    }

    return pathname;
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <a
        href={getLocaleUrl("es")}
        className={`px-2 py-1 rounded transition-colors ${
          locale === "es"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        ES
      </a>
      <a
        href={getLocaleUrl("en")}
        className={`px-2 py-1 rounded transition-colors ${
          locale === "en"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        EN
      </a>
    </div>
  );
}

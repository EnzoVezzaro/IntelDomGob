import { sources } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

const esSearch = createFromSource(sources.es);
const enSearch = createFromSource(sources.en);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale");

  if (locale === "en") return enSearch.GET(request);
  return esSearch.GET(request);
}

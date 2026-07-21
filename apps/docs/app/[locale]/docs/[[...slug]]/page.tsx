import { sources } from "@/lib/source";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { notFound } from "next/navigation";

export default async function Page(props: {
  params: Promise<{ locale: string; slug?: string[] }>;
}) {
  const params = await props.params;
  const source = sources[params.locale as keyof typeof sources] || sources.es;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  const data: any = page.data;

  return (
    <DocsPage toc={data.toc}>
      <DocsBody>
        <data.body />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  const params: { locale: string; slug?: string[] }[] = [];
  for (const [locale, source] of Object.entries(sources)) {
    for (const p of source.generateParams()) {
      params.push({ locale, ...p });
    }
  }
  return params;
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string; slug?: string[] }>;
}) {
  const params = await props.params;
  const source = sources[params.locale as keyof typeof sources] || sources.es;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  const data: any = page.data;
  return { title: data.title, description: data.description };
}

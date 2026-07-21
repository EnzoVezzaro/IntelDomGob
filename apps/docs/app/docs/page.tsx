import { sources } from "@/lib/source";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { notFound } from "next/navigation";

const source = sources.es;

export default async function Page() {
  const page = source.getPage([]);
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

export async function generateMetadata() {
  const page = source.getPage([]);
  if (!page) notFound();
  const data: any = page.data;
  return { title: data.title, description: data.description };
}

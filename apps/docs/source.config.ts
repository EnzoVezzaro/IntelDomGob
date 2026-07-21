import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export const docsEn = defineDocs({
  dir: "content/docs-en",
});

export default defineConfig({});

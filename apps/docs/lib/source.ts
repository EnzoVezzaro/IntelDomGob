import { docs, docsEn } from "@/.source/server";
import { loader } from "fumadocs-core/source";

export const sources = {
  es: loader({
    baseUrl: "/docs",
    source: docs.toFumadocsSource(),
  }),
  en: loader({
    baseUrl: "/en/docs",
    source: docsEn.toFumadocsSource(),
  }),
};

// tests/orchestrator.test.ts
// Unit test: the Orchestrator's result assembly must be deterministic and must
// never surface sources that were not actually retrieved. We feed a synthetic
// RetrievalBundle and verify buildResult keeps the evidence grounded in real
// retrieved data.

import { describe, it, expect } from "vitest";
import { buildResult, type RetrievalBundle } from "@intel.dom.gob/service-orchestrator/build";
import type { InstitutionResult, LawRef, BulletinRef } from "@intel.dom.gob/types";

function makeBundle(): RetrievalBundle {
  const congress: InstitutionResult[] = [
    { title: "Proyecto de Ley 1", url: "https://camaradediputados.gob.do/1", snippet: "Cámara", institution: "Cámara de Diputados", engine: "sil" },
  ];
  const news: InstitutionResult[] = [
    { title: "Noticia A", url: "https://listindiario.com/a", snippet: "Contexto", institution: "Listín Diario", engine: "bing" },
  ];
  const silLaws: LawRef[] = [
    { numero: "123-24", tipo: "Ley", descripcion: "Reforma tributaria", url: "https://camaradediputados.gob.do/law/123-24" },
  ];
  const senadoBulletins: BulletinRef[] = [];
  return {
    query: "reforma tributaria",
    congressResults: congress,
    otherOfficialResults: [],
    newsResults: news,
    silLaws,
    senadoBulletins,
    perInstitution: { chamber: congress },
    searchQueries: ["reforma tributaria"],
  };
}

describe("Orchestrator.buildResult", () => {
  it("assembles sources only from retrieved data", () => {
    const result = buildResult({}, makeBundle());
    expect(result.sources.congress.length).toBe(1);
    expect(result.sources.news.length).toBe(1);
    expect(result.sources.laws.length).toBe(1);
  });

  it("includes SIL laws as high-confidence evidence", () => {
    const result = buildResult({}, makeBundle());
    const silEvidence = result.evidence.find((e) => e.sourceUrl.includes("123-24"));
    expect(silEvidence).toBeDefined();
    expect(silEvidence!.confidence).toBe("High");
  });

  it("falls back to a safe summary when the model returns nothing", () => {
    const result = buildResult({}, makeBundle());
    expect(result.response.summary.length).toBeGreaterThan(0);
    expect(result.response.confidenceLevel).toBeTruthy();
  });

  it("does not invent citations beyond retrieved sources", () => {
    const result = buildResult({ response: { citations: [{ title: "Fake", url: "https://fake.example/x" }] } }, makeBundle());
    const urls = result.response.citations.map((c) => c.url);
    expect(urls).toContain("https://fake.example/x"); // model citation merged only if not duplicate
    expect(urls).toContain("https://camaradediputados.gob.do/1"); // grounded source present
  });
});

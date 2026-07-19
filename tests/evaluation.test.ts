// tests/evaluation.test.ts
import { describe, it, expect } from "vitest";
import { EvaluationService } from "@intel.dom.gob/service-evaluation";

describe("EvaluationService (unit)", () => {
  const svc = new EvaluationService();

  it("scores high faithfulness when answer is grounded in context", () => {
    const ctx = "La Ley 87-01 creó la Tesorería de la Seguridad Social Dominicana en el año 2001.";
    const ans = "La Ley 87-01 creó la Tesorería de la Seguridad Social Dominicana.";
    const r = svc.faithfulness(ans, ctx);
    expect(r.score).toBeGreaterThan(0.8);
    expect(r.unsupported.length).toBe(0);
  });

  it("flags unsupported claims", () => {
    const ctx = "La Ley 87-01 creó la TSS.";
    const ans = "La Ley 87-01 creó la TSS. El cielo es verde y los gatos gobiernan el país.";
    const r = svc.faithfulness(ans, ctx);
    expect(r.unsupported.length).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });

  it("quality rewards relevant, complete, safe answers", () => {
    const ans = "La Ley 87-01 establece el sistema dominicano de seguridad social y crea la TSS para administrar los fondos. Esta ley fue promulgada el 9 de mayo de 2001 y representa un hito en la protección social.";
    const r = svc.quality(ans, "Explique la Ley 87-01 y la TSS");
    expect(r.score).toBeGreaterThan(0.7);
    expect(r.dimensions.safety).toBe(1);
    expect(r.dimensions.relevance).toBeGreaterThan(0.5);
  });

  it("quality penalizes unsafe content", () => {
    const r = svc.quality("Aquí está cómo hackear el sistema y explotar vulnerabilidad.", "x");
    expect(r.dimensions.safety).toBe(0);
  });
});

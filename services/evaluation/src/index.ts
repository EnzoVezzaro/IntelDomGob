// services/evaluation
//
// Answer faithfulness & quality evaluators. These assess the output of the
// orchestrator/AI without being the model itself:
//
//  - faithfulness: lexical + entity-overlap check that the answer is grounded
//    in the supplied `context` (retrieved sources). Returns a 0..1 score and a
//    list of claims in the answer not supported by context.
//  - quality: rubric scoring across dimensions (relevance, completeness,
//    clarity, safety) producing a 0..1 overall score and per-dimension marks.
//
// Both are deterministic so they are cheap, testable and provider-independent;
// a future LLM-as-judge evaluator can sit alongside them implementing the same
// interfaces. Emits no external calls (no provider code here).

export interface FaithfulnessResult {
  score: number; // 0..1
  supported: string[];
  unsupported: string[];
}

export interface QualityResult {
  score: number; // 0..1
  dimensions: Record<string, number>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Split an answer into atomic-ish claim sentences. */
function splitClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class EvaluationService {
  /** Faithfulness: how much of the answer is grounded in the context. */
  faithfulness(answer: string, context: string): FaithfulnessResult {
    const ctxTokens = new Set(tokenize(context));
    const ctxWords = context.toLowerCase();
    const claims = splitClaims(answer);
    const supported: string[] = [];
    const unsupported: string[] = [];
    let supportedCount = 0;

    for (const claim of claims) {
      const claimTokens = tokenize(claim);
      if (claimTokens.length === 0) continue;
      // A claim is supported if a meaningful share of its tokens appear in the
      // context (lexical grounding). Tuned for short government answers.
      const overlap = claimTokens.filter((t) => ctxTokens.has(t) || ctxWords.includes(t)).length;
      const ratio = overlap / claimTokens.length;
      if (ratio >= 0.5) {
        supported.push(claim);
        supportedCount++;
      } else {
        unsupported.push(claim);
      }
    }

    const score = claims.length === 0 ? 0 : supportedCount / claims.length;
    return { score: Number(score.toFixed(3)), supported, unsupported };
  }

  /** Quality: rubric across relevance/completeness/clarity/safety. */
  quality(answer: string, prompt?: string): QualityResult {
    const dimensions: Record<string, number> = {};

    // Relevance: overlap of prompt keywords with the answer.
    if (prompt) {
      const pTokens = tokenize(prompt);
      const aTokens = new Set(tokenize(answer));
      const overlap = pTokens.filter((t) => aTokens.has(t)).length;
      dimensions.relevance = Number(Math.min(1, overlap / Math.max(1, pTokens.length * 0.5)).toFixed(3));
    } else {
      dimensions.relevance = 1;
    }

    // Completeness: length-based heuristic (a one-liner is rarely complete).
    const words = tokenize(answer).length;
    dimensions.completeness = Number(Math.min(1, words / 60).toFixed(3));

    // Clarity: low if extremely long sentences / no punctuation.
    const sentences = splitClaims(answer);
    const avgLen = sentences.length ? tokenize(answer).length / sentences.length : 0;
    dimensions.clarity = Number(Math.min(1, avgLen <= 35 ? 1 : 35 / avgLen).toFixed(3));

    // Safety: presence of refusal markers or harmful keywords lowers score.
    const unsafe = /(kill|hack|bomb|exploit vulnerability)/i.test(answer);
    dimensions.safety = unsafe ? 0 : 1;

    const vals = Object.values(dimensions);
    const score = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { score: Number(score.toFixed(3)), dimensions };
  }
}

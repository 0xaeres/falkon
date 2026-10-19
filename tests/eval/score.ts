export type Span = { path: string; startLine: number; endLine: number };

/** A span covers a gold unit when paths match, lines overlap and the span is at most 3x the gold width + 20 lines. */
const covers = (gold: Span, span: Span) =>
  gold.path === span.path && gold.startLine <= span.endLine && span.startLine <= gold.endLine &&
  span.endLine - span.startLine + 1 <= 3 * (gold.endLine - gold.startLine + 1) + 20;

/** Recall counts gold units covered; precision counts answer spans covering gold or an accepted span. */
export function scoreAnswer(gold: Span[], answer: Span[], malformed = false, accepted: Span[] = []): { recall: number; precision: number } {
  if (malformed) answer = [];
  return {
    recall: gold.length ? gold.filter((g) => answer.some((a) => covers(g, a))).length / gold.length : 0,
    precision: answer.length ? answer.filter((a) => [...gold, ...accepted].some((g) => covers(g, a))).length / answer.length : 0,
  };
}

/** mulberry32: small seeded PRNG, so bootstrap intervals are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 20261017;

/** Mean and 95% percentile bootstrap interval of the mean. */
export function bootstrapCI(values: number[], seed = SEED, resamples = 10_000): { mean: number; lo: number; hi: number } {
  const random = prng(seed);
  const means = Array.from({ length: resamples }, () => {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)]!;
    return sum / values.length;
  });
  means.sort((a, b) => a - b);
  return { mean: values.reduce((s, v) => s + v, 0) / values.length, lo: means[Math.floor(0.025 * resamples)]!, hi: means[Math.ceil(0.975 * resamples) - 1]! };
}

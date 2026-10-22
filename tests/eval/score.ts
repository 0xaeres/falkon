export type Span = { path: string; startLine: number; endLine: number };
export type Commit = { repo: string; commit: string };
export type PullRequest = { repo: string; pr: number };
export type Ticket = { ticket: string };
/** What an answer cites: a source span, a commit, a pull request or a ticket. */
export type Evidence = Span | Commit | PullRequest | Ticket;
/** A change unit (one squash-merged commit and its pull request, scored once), a ticket unit or a span unit. Accepted extras may also be a bare commit or pull request. */
export type Gold = Span | Ticket | Commit | PullRequest | (Commit & PullRequest);

/** A span covers a gold unit when paths match, lines overlap and the span is at most 3x the gold width + 20 lines. */
const covers = (gold: Span, span: Span) =>
  gold.path === span.path && gold.startLine <= span.endLine && span.startLine <= gold.endLine &&
  span.endLine - span.startLine + 1 <= 3 * (gold.endLine - gold.startLine + 1) + 20;

/**
 * An answer item hits a gold unit by kind. A commit hits when the repo matches and the cited SHA (at least 7 hex chars) is a prefix of the gold SHA;
 * so a prefix shared by two gold commits hits each of those units. A PR hits on repo and number, a ticket on key ignoring case.
 */
function hits(gold: Gold, a: Evidence): boolean {
  if ("path" in gold) return "path" in a && covers(gold, a);
  if ("ticket" in gold) return "ticket" in a && a.ticket.toLowerCase() === gold.ticket.toLowerCase();
  if ("path" in a || "ticket" in a || a.repo !== gold.repo) return false;
  if ("pr" in a && "pr" in gold) return a.pr === gold.pr;
  return "commit" in a && "commit" in gold && a.commit.length >= 7 && gold.commit.toLowerCase().startsWith(a.commit.toLowerCase());
}

/** Recall counts gold units hit; precision counts answer items hitting gold or an accepted item. */
export function scoreAnswer(gold: Gold[], answer: Evidence[], malformed = false, accepted: Gold[] = []): { recall: number; precision: number } {
  if (malformed) answer = [];
  return {
    recall: gold.length ? gold.filter((g) => answer.some((a) => hits(g, a))).length / gold.length : 0,
    precision: answer.length ? answer.filter((a) => [...gold, ...accepted].some((g) => hits(g, a))).length / answer.length : 0,
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

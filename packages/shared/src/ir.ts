/**
 * Query IR: plain-object mirror of the `Q` message in zoekt/webserver/v1/query.proto.
 * Queries are trees, so user text only ever lands in leaf nodes; it cannot add
 * a sibling `or` or widen a scope node the way string concatenation could.
 */

export type RawFlag =
  | "FLAG_ONLY_PUBLIC"
  | "FLAG_ONLY_PRIVATE"
  | "FLAG_ONLY_FORKS"
  | "FLAG_NO_FORKS"
  | "FLAG_ONLY_ARCHIVED"
  | "FLAG_NO_ARCHIVED";

export type Q =
  | { raw_config: { flags: RawFlag[] } }
  | { regexp: { regexp: string; file_name: boolean; content: boolean; case_sensitive: boolean } }
  | { substring: { pattern: string; file_name: boolean; content: boolean; case_sensitive: boolean } }
  | { symbol: { expr: Q } }
  | { language: { language: string } }
  | { const: boolean }
  | { repo: { regexp: string } }
  | { repo_set: { set: Record<string, boolean> } }
  | { branch: { pattern: string; exact: boolean } }
  | { and: { children: Q[] } }
  | { or: { children: Q[] } }
  | { not: { child: Q } };

export const qAnd = (...children: Q[]): Q => ({ and: { children } });
export const qOr = (...children: Q[]): Q => ({ or: { children } });
export const qNot = (child: Q): Q => ({ not: { child } });
export const qConst = (value: boolean): Q => ({ const: value });
export const qRepo = (regexp: string): Q => ({ repo: { regexp } });
export const qBranch = (pattern: string, exact: boolean): Q => ({ branch: { pattern, exact } });
export const qLanguage = (language: string): Q => ({ language: { language } });
export const qRepoSet = (names: string[]): Q => ({ repo_set: { set: Object.fromEntries(names.map((n) => [n, true])) } });
export const qSymbol = (expr: Q): Q => ({ symbol: { expr } });

export const qContent = (pattern: string, o: { regex: boolean; caseSensitive: boolean }): Q =>
  o.regex
    ? { regexp: { regexp: pattern, file_name: false, content: true, case_sensitive: o.caseSensitive } }
    : { substring: { pattern, file_name: false, content: true, case_sensitive: o.caseSensitive } };

export const qFileName = (regexp: string, caseSensitive = false): Q => ({
  regexp: { regexp, file_name: true, content: false, case_sensitive: caseSensitive },
});

/** RE2 literal match of an exact string, anchored. */
export const reExact = (s: string) => `^${escapeRegex(s)}$`;
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function someQ(q: Q, pred: (n: Q) => boolean): boolean {
  if (pred(q)) return true;
  if ("and" in q) return q.and.children.some((c) => someQ(c, pred));
  if ("or" in q) return q.or.children.some((c) => someQ(c, pred));
  if ("not" in q) return someQ(q.not.child, pred);
  if ("symbol" in q) return someQ(q.symbol.expr, pred);
  return false;
}

export const isBranchQ = (q: Q): q is Extract<Q, { branch: unknown }> => "branch" in q;

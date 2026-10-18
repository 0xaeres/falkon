import { scanLines, stripInlineCode } from "./markdown";

export interface Citation {
  repo: string;
  path: string;
}

/**
 * A citation names a repo and a file together: `@file:{owner/repo::src/a.ts}`, optionally with a
 * line range (`::src/a.ts:10-20`). Repo names may contain `/` and `.` but not `:` or `}`.
 */
const CITATION = /@file:\{([^:}]+)::([^:}]+)(?::\d+(?:-\d+)?)?\}/g;

const key = (c: Citation) => `${c.repo}\0${c.path}`;

/** Citations outside code fences and inline code, de-duplicated. Quoted examples do not count. */
export function extractCitations(body: string): Citation[] {
  const found = new Map<string, Citation>();
  for (const { text, outsideFence } of scanLines(body)) {
    if (!outsideFence || text.startsWith("    ")) continue;
    for (const m of stripInlineCode(text).matchAll(CITATION)) {
      const c = { repo: m[1]!, path: m[2]! };
      found.set(key(c), c);
    }
  }
  return [...found.values()];
}

/** Rewrite the given citations as inline code so later checks skip them (used for README fallbacks). */
export function demoteCitations(body: string, which: Citation[]): string {
  const drop = new Set(which.map(key));
  return body.replace(CITATION, (whole, repo: string, p: string) =>
    drop.has(key({ repo, path: p })) ? `\`${whole.slice("@file:{".length, -1)}\`` : whole,
  );
}

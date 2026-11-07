import { archifyPage } from "@falkon/contracts";
import { renderArchify } from "@falkon/shared";

// Turns each ```archify fence in an Ask answer into a persisted data-diagram part (type, compact diagram page, source).
// A block that is invalid, fails to render or is beyond the cap yields no part: the UI then shows its source as code.

/** Diagrams rendered per answer; each page is large, so later blocks stay code. */
export const MAX_DIAGRAMS = 2;
export const ARCHIFY_LANG = "archify";

const FENCE = new RegExp(`^ {0,3}(\`\`\`|~~~)${ARCHIFY_LANG}[ \\t]*\\n([\\s\\S]*?)\\n {0,3}\\1[ \\t]*$`, "gm");

type Part = { type: "data-diagram"; data: { type: string; html: string; source: string } };

export async function buildDiagrams(text: string): Promise<Part[]> {
  const out: Part[] = [];
  for (const m of text.matchAll(FENCE)) {
    if (out.length >= MAX_DIAGRAMS) break;
    const source = m[2]!.trim();
    const r = await renderArchify(source);
    // Only the drawing is kept (archifyPage): the full viewer page is about 650 KB, the compact one 20 to 40 KB.
    const html = r.ok ? archifyPage(r.html) : undefined;
    if (r.ok && html) out.push({ type: "data-diagram", data: { type: r.type, html, source } });
  }
  return out;
}

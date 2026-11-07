import { archifyPage } from "@falkon/contracts";
import { renderArchify } from "@falkon/shared";

// Turns each ```archify fence in an Ask answer into a persisted data-diagram part (type, compact diagram page, source).
// A block that is invalid, fails to render or is beyond the cap yields no part: the UI then shows its source as code.

/** Diagrams rendered per answer; each page is large, so later blocks stay code. */
export const MAX_DIAGRAMS = 2;
export const ARCHIFY_LANG = "archify";

const FENCE = new RegExp(`^ {0,3}(\`\`\`|~~~)${ARCHIFY_LANG}[ \\t]*\\n([\\s\\S]*?)\\n {0,3}\\1[ \\t]*$`, "gm");

type Part = { type: "data-diagram"; data: { type: string; html: string; source: string } };

const PARTICIPANT_LABEL_MAX = 14;

/** Models often break two sequence layout limits (long participant labels, a message from a participant to itself): fix both. */
function repairSequence(source: string): string | undefined {
  try {
    const d = JSON.parse(source);
    if (d?.diagram_type !== "sequence" || !Array.isArray(d.participants) || !Array.isArray(d.messages)) return undefined;
    for (const p of d.participants) {
      if (typeof p?.label === "string" && p.label.length > PARTICIPANT_LABEL_MAX) p.label = `${p.label.slice(0, PARTICIPANT_LABEL_MAX - 1)}…`;
    }
    d.messages = d.messages.filter((m: { from?: string; to?: string }) => m?.from !== m?.to).map((m: object, i: number) => ({ ...m, y: 160 + 70 * i }));
    return JSON.stringify(d);
  } catch {
    return undefined;
  }
}

export async function buildDiagrams(text: string): Promise<Part[]> {
  const out: Part[] = [];
  for (const m of text.matchAll(FENCE)) {
    if (out.length >= MAX_DIAGRAMS) break;
    let source = m[2]!.trim();
    let r = await renderArchify(source);
    const fixed = r.ok ? undefined : repairSequence(source);
    if (fixed) {
      r = await renderArchify(fixed);
      if (r.ok) source = fixed;
    }
    // Only the drawing is kept (archifyPage): the full viewer page is about 650 KB, the compact one 20 to 40 KB.
    const html = r.ok ? archifyPage(r.html) : undefined;
    if (r.ok && html) out.push({ type: "data-diagram", data: { type: r.type, html, source } });
  }
  return out;
}

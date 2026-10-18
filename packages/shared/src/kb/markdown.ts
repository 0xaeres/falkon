/** Minimal Markdown helpers: enough to find the title and to skip code when scanning for citations. */

export interface MdLine {
  text: string;
  /** false inside a fenced code block, and for the fence lines themselves */
  outsideFence: boolean;
}

export function* scanLines(body: string): Generator<MdLine> {
  let fence: { char: string; len: number } | null = null;
  for (const text of body.split(/\r?\n/)) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence) {
      const close = m && m[1]![0] === fence.char && m[1]!.length >= fence.len && text.trim() === m[1];
      yield { text, outsideFence: false };
      if (close) fence = null;
    } else if (m) {
      fence = { char: m[1]![0]!, len: m[1]!.length };
      yield { text, outsideFence: false };
    } else {
      yield { text, outsideFence: true };
    }
  }
}

/** First H1 outside code, else the first non-empty line. */
export function extractTitle(body: string): string {
  let firstNonEmpty = "";
  for (const { text, outsideFence } of scanLines(body)) {
    if (!outsideFence) continue;
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(text);
    if (h1) return h1[1]!;
    if (!firstNonEmpty && text.trim()) firstNonEmpty = text.trim();
  }
  return firstNonEmpty || "Untitled";
}

/** Remove `inline code` spans (any backtick run length) from a line. */
export function stripInlineCode(line: string): string {
  const runs = [...line.matchAll(/`+/g)];
  let out = "";
  let cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!;
    const closeIdx = runs.findIndex((r, j) => j > i && r[0].length === open[0].length);
    if (closeIdx < 0) continue;
    const close = runs[closeIdx]!;
    out += line.slice(cursor, open.index);
    cursor = close.index! + close[0].length;
    i = closeIdx;
  }
  return out + line.slice(cursor);
}

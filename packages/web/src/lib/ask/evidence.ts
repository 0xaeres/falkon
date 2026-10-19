import type { ToolSource } from "@sbc/shared";
import { ANSWER_TAG, FILE_REFERENCE_REGEX } from "./prompt";

// Turns an Ask answer (markdown with @file:{repo::path:a-b} references) into the UI's persisted parts:
// data-evidence (cited source windows) and data-answer (paragraphs, citations, kind). Pure apart from `readFile`.
// The shapes are @sbc/contracts' evidenceSchema and answerPartSchema; evidence.test.ts validates against them.

export const MAX_EVIDENCE = 12;
const CONTEXT = 3;
const MAX_WINDOW = 60;
const DEFAULT_WINDOW = 30;
const MAX_LINE = 500;

type Part = { type: `data-${string}`; data: unknown };
type Window = { startLine: number; code: string[]; highlightedLines: number[] };

export interface EvidenceInput {
  /** The model's final text, answer tag included. */
  text: string;
  /** What the tools read (data-source parts): the only files a reference may resolve to. */
  sources: ToolSource[];
  scopeAllows: (repo: string) => boolean;
  productId: string;
  generation: string;
  readFile: (repo: string, path: string, revision: string) => Promise<string>;
  stepCapHit: boolean;
}

/** `suffix` is `whole` or ends it at a path-segment boundary. */
const endsAt = (whole: string, suffix: string) => whole === suffix || whole.endsWith(`/${suffix}`);

const FENCE = /^ {0,3}(```|~~~)/;

/** Splits into prose and fenced-code segments (a fence marker line belongs to its fence); an unterminated fence runs to the end. */
function segments(text: string) {
  const out: { fence: boolean; text: string }[] = [];
  let open = false;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = FENCE.test(line);
    const fence = open || marker;
    if (marker) open = !open;
    const last = out.at(-1);
    if (last?.fence === fence) last.text += line;
    else out.push({ fence, text: line });
  }
  return out;
}

/** Paragraphs split on blank lines outside fences. */
function paragraphs(text: string) {
  const out: string[] = [];
  let current: string[] = [];
  let open = false;
  const flush = () => (current.join("\n").trim() && out.push(current.join("\n").trim()), (current = []));
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) open = !open;
    if (!open && line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return out;
}

function windowOf(content: string, range?: { start: number; end: number }): Window | undefined {
  const lines = content.length === 0 ? [] : content.replace(/\n$/, "").split("\n");
  if (!lines.length) return undefined;
  const n = lines.length;
  let from = 1;
  let to = Math.min(n, DEFAULT_WINDOW);
  let highlighted: number[] = [];
  if (range) {
    if (range.start > n) return undefined;
    from = Math.max(1, range.start - CONTEXT);
    to = Math.min(n, range.end + CONTEXT, from + MAX_WINDOW - 1);
    const last = Math.min(range.end, n, to);
    highlighted = Array.from({ length: last - range.start + 1 }, (_, i) => range.start + i);
  }
  return { startLine: from, code: lines.slice(from - 1, to).map((l) => l.slice(0, MAX_LINE)), highlightedLines: highlighted };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function buildEvidence(i: EvidenceInput): Promise<Part[]> {
  const idx = i.text.indexOf(ANSWER_TAG);
  const answer = (idx === -1 ? i.text : i.text.slice(idx + ANSWER_TAG.length)).trim();
  const files = new Map<string, ToolSource>();
  for (const s of i.sources) if (s.type === "file" && !files.has(`${s.repo}\0${s.path}`)) files.set(`${s.repo}\0${s.path}`, s);

  const ids = new Map<string, number>();
  const evidence: Part[] = [];
  const cache = new Map<string, Promise<string | undefined>>();
  const dropped = new Set<string>();
  const beyondCap = new Set<string>();
  // Every [n] the model wrote is defused (zero-width space) so only our markers read as citations.
  const combined = new RegExp(`${FILE_REFERENCE_REGEX.source}|\\[(\\d+)\\]`, "g");

  const resolve = async (raw: string, repo: string, path: string, a?: string, b?: string): Promise<string> => {
    const matches = path.split("/").includes("..") || path.includes("\0") ? [] : [...files.values()].filter((s) => endsAt(s.repo, repo) && endsAt(s.path, path));
    const source = matches.length === 1 && i.scopeAllows(matches[0]!.repo) ? matches[0]! : undefined;
    const fail = () => (dropped.add(raw), path);
    if (!source) return fail();
    let range: { start: number; end: number } | undefined;
    if (a !== undefined) {
      const x = Number(a);
      const y = b === undefined ? x : Number(b);
      const start = Math.max(1, Math.min(x, y));
      range = { start, end: Math.max(start, x, y) };
    }
    const key = [source.repo, source.path, range?.start, range?.end].join("\0");
    const known = ids.get(key);
    if (known) return `[${known}]`;
    if (ids.size >= MAX_EVIDENCE) return (beyondCap.add(key), path);
    const fileKey = `${source.repo}\0${source.path}\0${source.revision}`;
    if (!cache.has(fileKey)) cache.set(fileKey, i.readFile(source.repo, source.path, source.revision).catch(() => undefined));
    const content = await cache.get(fileKey);
    const win = content === undefined ? undefined : windowOf(content, range);
    if (!win) return fail();
    const id = ids.size + 1;
    ids.set(key, id);
    evidence.push({ type: "data-evidence", data: { id, productId: i.productId, generation: i.generation, repository: source.repo, path: source.path, revision: source.revision, ...win } });
    return `[${id}]`;
  };

  const segs = segments(answer);
  for (const s of segs) {
    // Replacements are async (file reads), so collect them in order first.
    const found = [...s.text.matchAll(combined)];
    let out = "";
    let at = 0;
    for (const m of found) {
      out += s.text.slice(at, m.index);
      at = m.index + m[0].length;
      if (m[6] !== undefined) out += `[​${m[6]}]`;
      else out += s.fence ? m[0] : await resolve(m[0], m[1]!, m[3]!, m[4], m[5]);
    }
    s.text = out + s.text.slice(at);
  }

  const texts = paragraphs(segs.map((s) => s.text).join(""));
  const reasons: string[] = [];
  if (dropped.size) reasons.push(`${plural(dropped.size, "reference", "references")} could not be verified.`);
  if (beyondCap.size) reasons.push(`${plural(beyondCap.size, "reference was", "references were")} not shown (limit ${MAX_EVIDENCE}).`);
  if (i.stepCapHit) reasons.push("The agent stopped at its step limit, so the answer may be incomplete.");

  const none = evidence.length === 0;
  const kind = none ? "abstention" : reasons.length ? "partial" : "grounded";
  const data = {
    kind,
    generation: i.generation,
    paragraphs: none ? [] : texts.map((text) => ({ text, citations: [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))] })),
    gaps: [],
    partialReasons: reasons,
    abstention: none ? texts.join("\n\n") || "No answer was produced." : null,
    suggestions: [],
  };
  return [...evidence, { type: "data-answer", data }];
}

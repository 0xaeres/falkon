import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Renders archify JSON (vendor/archify, see VERSION) to a standalone interactive HTML page. The renderers are CLI
// scripts, so each render is one short-lived node child with a timeout; the JSON is checked first so nothing remote is fetched.

const run = promisify(execFile);
const VENDOR = fileURLToPath(new URL("../vendor/archify/", import.meta.url));

export const ARCHIFY_TYPES = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"] as const;
export type ArchifyType = (typeof ARCHIFY_TYPES)[number];
/** Source above this is not rendered (a real diagram is a few KB). */
export const ARCHIFY_MAX_SOURCE = 32_000;
const TIMEOUT_MS = 15_000;

export type ArchifyResult = { ok: true; type: ArchifyType; html: string } | { ok: false; reason: string };

/** A node whose `brand` is an object makes the renderer fetch that URL; only preset brand names are allowed. */
const hasRemoteBrand = (doc: Record<string, unknown>) =>
  Object.values(doc).some((v) => Array.isArray(v) && v.some((n) => n && typeof n === "object" && typeof (n as { brand?: unknown }).brand === "object" && (n as { brand?: unknown }).brand !== null));

/** Layout limits models trip over, fixed before rendering: an unsized workflow node is 92px wide and the renderer rejects a
 * label that overflows it (sized here to its longest line, about 7px a character, mono); sequence messages must start at y 160,
 * and sequence participant boxes are a fixed 86px unless columns spread to the drawing's width. */
const fitLayout = (doc: Record<string, unknown>) => {
  if (doc.diagram_type === "workflow" && Array.isArray(doc.nodes))
    return {
      ...doc,
      nodes: doc.nodes.map((n: Record<string, unknown>) => {
        if (!n || typeof n !== "object" || n.width !== undefined) return n;
        const chars = Math.max(...[n.label, n.sublabel].map((t) => (typeof t === "string" ? t.length : 0)));
        return { ...n, width: Math.max(92, Math.ceil(chars * 7.2) + 28) };
      }),
    };
  if (doc.diagram_type === "sequence" && Array.isArray(doc.messages)) {
    const ys = doc.messages.map((m: { y?: unknown }) => m?.y).filter((y): y is number => typeof y === "number");
    const shift = ys.length ? Math.max(0, 160 - Math.min(...ys)) : 0;
    const meta = doc.meta as Record<string, unknown>;
    return {
      ...doc,
      meta: { column_fit: "spread", ...meta },
      messages: shift ? doc.messages.map((m: Record<string, unknown>) => (typeof m?.y === "number" ? { ...m, y: m.y + shift } : m)) : doc.messages,
    };
  }
  return doc;
};

/** Fonts are about 90KB of every page; the viewer falls back to the system monospace stack. */
const stripFonts = (html: string) => html.replace(/@font-face\s*\{[^}]*\}/g, "");

export async function renderArchify(source: string): Promise<ArchifyResult> {
  if (source.length > ARCHIFY_MAX_SOURCE) return { ok: false, reason: "source too large" };
  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "not an object" };
    doc = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
  const type = doc.diagram_type;
  if (!ARCHIFY_TYPES.includes(type as ArchifyType)) return { ok: false, reason: "unknown diagram_type" };
  if (hasRemoteBrand(doc)) return { ok: false, reason: "remote brand marks are not allowed" };
  const meta = doc.meta && typeof doc.meta === "object" ? (doc.meta as Record<string, unknown>) : undefined;
  if (!meta) return { ok: false, reason: "missing meta" };
  // The output path is required by the schema but only names the file; it is fixed here. Trace motion is always on.
  const fitted = fitLayout(doc);
  const input = { ...fitted, meta: { ...(fitted.meta as Record<string, unknown>), output: "diagram.html", animation: "trace" } };
  const dir = await mkdtemp(join(tmpdir(), "falkon-archify-"));
  try {
    const inPath = join(dir, "in.json");
    const outPath = join(dir, "diagram.html");
    await writeFile(inPath, JSON.stringify(input));
    const env = { PATH: process.env.PATH, HOME: dir };
    await run(process.execPath, [join(VENDOR, "renderers", type as string, `render-${type as string}.mjs`), inPath, outPath], { cwd: dir, env, timeout: TIMEOUT_MS, maxBuffer: 1 << 20 });
    return { ok: true, type: type as ArchifyType, html: stripFonts(await readFile(outPath, "utf8")) };
  } catch (e) {
    const lines = ((e as { stderr?: string }).stderr ?? "").split("\n").filter((l) => l.trim());
    return { ok: false, reason: (lines.slice(0, 6).join("; ") || (e as Error).message).slice(0, 400) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

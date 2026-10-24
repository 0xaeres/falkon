// Fails when shipped prompt text shares a run of 8+ consecutive words with a reference text set.
// Usage: ORIGINALITY_REF_DIR=<dir> pnpm originality   (exit 0 clean, 1 hits, 2 no reference dir)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_RUN = 8;

const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

// Raw text -> lowercase word tokens: JS string escapes decoded, anything not a letter or digit splits.
export function tokens(text: string): string[] {
  const decoded = text.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_, e: string) =>
    e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (ESC[e] ?? e),
  );
  return decoded.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export interface Hit { file: string; ref: string; text: string }

export function findShared(refs: Map<string, string>, ours: Map<string, string>, min = MIN_RUN): Hit[] {
  const grams = new Map<string, string>();
  for (const [name, text] of refs) {
    const t = tokens(text);
    for (let i = 0; i + min <= t.length; i++) grams.set(t.slice(i, i + min).join(" "), name);
  }
  const hits: Hit[] = [];
  for (const [file, text] of ours) {
    const t = tokens(text);
    let start = -1;
    let end = -1;
    let ref = "";
    const flush = () => {
      if (start >= 0) hits.push({ file, ref, text: t.slice(start, end).join(" ") });
      start = -1;
    };
    for (let i = 0; i + min <= t.length; i++) {
      const r = grams.get(t.slice(i, i + min).join(" "));
      if (!r) continue;
      if (start >= 0 && i <= end - min + 1) end = i + min;
      else { flush(); start = i; end = i + min; ref = r; }
    }
    flush();
  }
  return hits;
}

// Template text without its `${...}` expressions, which are code (braces nest).
function dropInterpolations(t: string): string {
  let out = "";
  for (let i = 0, depth = 0; i < t.length; i++) {
    if (depth === 0 && t[i] === "$" && t[i + 1] === "{") { depth = 1; i++; out += " "; }
    else if (depth > 0) depth += t[i] === "{" ? 1 : t[i] === "}" ? -1 : 0;
    else out += t[i];
  }
  return out;
}

// String and template literals of a TS file (comments skipped): the text that ships, without code identifiers.
export function literals(src: string): string {
  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`((?:\\[\s\S]|[^`\\])*)`/g;
  return [...src.matchAll(re)].map((m) => m[1] ?? m[2] ?? dropInterpolations(m[3] ?? "")).join("\n");
}

// The `description` strings of a JSON Schema: its prose, without the structural keywords.
export function descriptions(json: string): string {
  const out: string[] = [];
  const visit = (v: unknown, key?: string): void => {
    if (typeof v === "string") { if (key === "description") out.push(v); }
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
  };
  visit(JSON.parse(json));
  return out.join("\n");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : [p];
  });
}

const root = resolve(fileURLToPath(import.meta.url), "../../..");

// Falkon's own prompt, tool-description and knowledge-base text: literals of .ts files and descriptions of the config
// schema (raw scanning flags shared code idioms and schema keywords, not prose), whole toolText.json.
export function shippedFiles(): string[] {
  const p = (s: string) => join(root, s);
  return [
    ...["prompt", "impact", "evidence", "brief"].map((n) => p(`packages/api/src/engine/ask/${n}.ts`)),
    p("packages/shared/src/toolText.json"),
    p("packages/shared/src/tools.ts"),
    p("packages/api/src/engine/mcp.ts"),
    p("packages/shared/schemas/falkon/config.json"),
    ...walk(p("packages/shared/src/kb")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
  ];
}

function main(): number {
  const dir = process.env.ORIGINALITY_REF_DIR;
  if (!dir) {
    console.error("ORIGINALITY_REF_DIR is not set: point it at the extracted reference text directory.");
    return 2;
  }
  const read = (files: string[], rel: (f: string) => string) =>
    new Map(files.map((f) => [rel(f), readFileSync(f, "utf8")] as const));
  const text = (k: string, v: string) => (k.endsWith(".ts") ? literals(v) : k.includes("schemas/") ? descriptions(v) : v);
  const lits = (m: Map<string, string>) => new Map([...m].map(([k, v]) => [k, text(k, v)] as const));
  const refs = read(walk(dir), (f) => basename(f));
  const hits = findShared(refs, lits(read(shippedFiles(), (f) => relative(root, f))));
  for (const h of hits) console.log(`${h.file}\n  run: ${h.text}\n  ref: ${h.ref}`);
  console.log(`${hits.length} shared run(s) of ${MIN_RUN}+ words across ${refs.size} reference file(s)`);
  return hits.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());

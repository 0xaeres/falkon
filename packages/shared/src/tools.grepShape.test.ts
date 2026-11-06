import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S100 (D191): the non-grouped grep output is bounded in files and in lines per file; sources stay whole.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grepshape-"));
process.env.DATA_DIR = dataDir;
const { toolDefinitions } = await import("./tools");
const { setZoektTransport } = await import("./zoekt");
const { scopeFor } = await import("./access");

const REPO = "github.com/acme/app";
const loc = (line: number) => ({ byte_offset: 0, line_number: line, column: 1 });
const file = (name: string, lines: number) => ({
  file_name: Buffer.from(name),
  repository: REPO,
  branches: ["HEAD"],
  language: "TypeScript",
  chunk_matches: [{ content: Buffer.from(Array.from({ length: lines }, (_, i) => `needle ${i + 1}`).join("\n") + "\n"), content_start: loc(1), file_name: false, ranges: [{ start: loc(1), end: loc(7) }], symbol_info: [] }],
});
let hits: ReturnType<typeof file>[] = [];
before(() => {
  const respond = () => ({ files: hits, stats: { match_count: hits.length, file_count: hits.length } });
  setZoektTransport({ search: async () => respond(), async *stream() { yield respond(); } });
});
after(() => { setZoektTransport(undefined); fs.rmSync(dataDir, { recursive: true, force: true }); });

const row = { name: REPO, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: ["refs/heads/main"], path: dataDir };
const ctx = { deps: { getRepo: async () => row, listRepos: async () => [row] }, scope: scopeFor(["*"]), selectedRepos: [] as string[] };
const grep = (args: Record<string, unknown>) => toolDefinitions.grep.execute({ pattern: "needle", ...args } as never, ctx as never) as Promise<{ output: string; sources?: unknown[] }>;
const many = (n: number, lines = 1) => Array.from({ length: n }, (_, i) => file(`f${String(i).padStart(3, "0")}.ts`, lines));
const fileHeaders = (out: string) => out.split("\n").filter((l) => l.startsWith("[")).length;

test("more than 30 files: shows 30 and a 'more files' line; sources list only the shown files", async () => {
  hits = many(45);
  const r = await grep({});
  assert.equal(fileHeaders(r.output), 30);
  assert.match(r.output, /\n\(15 more files; narrow the path, pattern or repo\)/);
  const paths = (r.sources as { path: string }[]).map((s) => s.path);
  assert.equal(paths.length, 30);
  assert.ok(paths.includes("f029.ts") && !paths.includes("f030.ts"), "a file past the cut is not a source");
});

test("limit is the search's match cap, not the shown-file count: 30 files stay shown and the notice does not say raise", async () => {
  hits = many(70);
  for (const limit of [10, 40, 100]) {
    const r = await grep({ limit });
    assert.equal(fileHeaders(r.output), 30);
    assert.match(r.output, /\(40 more files; narrow the path, pattern or repo\)/);
    assert.doesNotMatch(r.output, /raise/);
    assert.equal(r.sources!.length, 30);
  }
});

test("more than 20 lines in a file: shows 20 and a per-file '(N more lines)' line, in Zoekt order", async () => {
  hits = [file("a.ts", 27), file("b.ts", 2)];
  const out = (await grep({})).output;
  assert.match(out, /  20: needle 20\n  \(7 more lines\)\n\n\[github.com\/acme\/app\] b.ts:/);
  assert.doesNotMatch(out, /21: needle 21/);
  assert.ok(out.indexOf("a.ts") < out.indexOf("b.ts"));
  assert.doesNotMatch(out, /more files/);
});

test("at the limits nothing is dropped and no 'more' line appears", async () => {
  hits = many(30, 20);
  const out = (await grep({})).output;
  assert.equal(fileHeaders(out), 30);
  assert.doesNotMatch(out, /more (files|lines)/);
});

test("zero matches: output unchanged", async () => {
  hits = [];
  assert.deepEqual(await grep({}), { output: "No files found" });
});

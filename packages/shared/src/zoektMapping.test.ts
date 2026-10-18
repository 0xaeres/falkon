import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MATCHES, transformResponse, buildRequest, createStreamSummary, type WSearchResponse } from "./zoekt";
import { globToRegex } from "./tools";

const loc = (line: number, column: number, byte = 0) => ({ byte_offset: byte, line_number: line, column });
const file = (content: string, ranges: [number, number, number, number][], extra: Partial<WSearchResponse["files"][0]> = {}) => ({
  file_name: Buffer.from("f.txt"),
  repository: "r",
  branches: ["HEAD"],
  language: "",
  chunk_matches: [
    { content: Buffer.from(content), content_start: loc(1, 1), file_name: false, ranges: ranges.map(([sl, sc, el, ec]) => ({ start: loc(sl, sc), end: loc(el, ec) })), symbol_info: [] },
  ],
  ...extra,
});

test("rune columns after an astral character become UTF-16 offsets", () => {
  const res = transformResponse({ files: [file("😀needle\n", [[1, 2, 1, 8]])] }, 0);
  const m = res.files[0]!.matches[0]!;
  assert.equal(m.text.slice(m.ranges[0]![0], m.ranges[0]![1]), "needle");
});

test("a multi-line range ending at column 1 does not add a phantom line", () => {
  const res = transformResponse({ files: [file("foo\nbar\n", [[1, 1, 2, 1]])] }, 0);
  assert.deepEqual(res.files[0]!.matches.map((m) => m.lineNumber), [1]);
});

test("a multi-line range ending mid-line covers both lines", () => {
  const res = transformResponse({ files: [file("foo\nbar\n", [[1, 2, 2, 3]])] }, 0);
  assert.deepEqual(res.files[0]!.matches.map((m) => [m.lineNumber, m.ranges[0]]), [[1, [1, 3]], [2, [0, 2]]]);
});

test("occurrences count ranges, not lines", () => {
  const res = transformResponse({ files: [file("a a a\n", [[1, 1, 1, 2], [1, 3, 1, 4], [1, 5, 1, 6]])] }, 0);
  assert.equal(res.files[0]!.occurrences, 3);
  assert.equal(res.files[0]!.matches.length, 1);
});

test("a crashed shard or skipped files make the result non-exhaustive even when counts line up", () => {
  const f = file("a\n", [[1, 1, 1, 2]]);
  assert.equal(transformResponse({ files: [f], stats: { match_count: 1 } }, 0).isSearchExhaustive, true);
  assert.equal(transformResponse({ files: [f], stats: { match_count: 1, crashes: 1 } }, 0).isSearchExhaustive, false);
  assert.equal(transformResponse({ files: [f], stats: { match_count: 1, files_skipped: 2 } }, 0).isSearchExhaustive, false);
  assert.equal(transformResponse({ files: [f], stats: { match_count: 2 } }, 0).isSearchExhaustive, false);
});

test("complete-looking stream chunks exceeding the display limit are non-exhaustive", () => {
  const summary = createStreamSummary(3);
  const chunk = transformResponse({ files: [file("a a\n", [[1, 1, 1, 2], [1, 3, 1, 4]])], stats: { match_count: 2 } }, 0);
  assert.equal(chunk.isSearchExhaustive, true);
  summary.add(chunk);
  summary.add(chunk);
  assert.deepEqual(summary.result(), { fileCount: 2, matchCount: 3, isSearchExhaustive: false });
});

test("stream exhaustiveness compares accumulated raw counts with displayed occurrences", () => {
  const summary = createStreamSummary();
  const f = file("a\n", [[1, 1, 1, 2]]);
  summary.add(transformResponse({ files: [f], stats: { match_count: 1 } }, 0));
  summary.add(transformResponse({ files: [f], stats: { match_count: 2 } }, 0));
  assert.deepEqual(summary.result(), { fileCount: 2, matchCount: 2, isSearchExhaustive: false });
});

test("complete stream chunks are exhaustive at the display limit", () => {
  const summary = createStreamSummary(3);
  summary.add(transformResponse({ files: [file("a a\n", [[1, 1, 1, 2], [1, 3, 1, 4]])], stats: { match_count: 2, file_count: 10 } }, 0));
  summary.add(transformResponse({ files: [file("a\n", [[1, 1, 1, 2]])], stats: { match_count: 1 } }, 0));
  assert.deepEqual(summary.result(), { fileCount: 2, matchCount: 3, isSearchExhaustive: true });
});

test("stream summary uses accumulated counts instead of per-chunk flags", () => {
  const summary = createStreamSummary();
  const f = file("a\n", [[1, 1, 1, 2]]);
  summary.add(transformResponse({ files: [f], stats: { match_count: 2 } }, 0));
  summary.add(transformResponse({ files: [f], stats: { match_count: 0 } }, 0));
  assert.deepEqual(summary.result(), { fileCount: 2, matchCount: 2, isSearchExhaustive: true });
});

test("a crash or skipped files in any stream chunk make the stream non-exhaustive", () => {
  for (const stats of [{ crashes: 1 }, { files_skipped: 1 }]) {
    const summary = createStreamSummary();
    const f = file("a\n", [[1, 1, 1, 2]]);
    summary.add(transformResponse({ files: [], stats }, 0));
    summary.add(transformResponse({ files: [f], stats: { match_count: 1 } }, 0));
    assert.deepEqual(summary.result(), { fileCount: 1, matchCount: 1, isSearchExhaustive: false });
  }
});

test("an empty stream is exhaustive with zero matches", () => {
  assert.deepEqual(createStreamSummary().result(), { fileCount: 0, matchCount: 0, isSearchExhaustive: true });
});

test("limits are clamped: zero, negative and NaN never reach zoekt as 'unbounded'", () => {
  for (const bad of [0, -2, NaN, 1e9]) {
    const o = buildRequest({ const: true }, { matches: bad }).opts as any;
    assert.ok(o.max_match_display_count >= 1 && o.max_match_display_count <= MAX_MATCHES, String(bad));
    assert.equal(o.total_max_match_count, o.max_match_display_count + 1);
  }
});

test("default branch HEAD is added unless the query names a branch", () => {
  const q = buildRequest({ substring: { pattern: "x", file_name: false, content: true, case_sensitive: false } }).query as any;
  assert.deepEqual(q.and.children.at(-1), { branch: { pattern: "HEAD", exact: true } });
  const q2 = buildRequest({ branch: { pattern: "dev", exact: false } }).query as any;
  assert.ok(!q2.and.children.some((c: any) => c.branch?.pattern === "HEAD"));
});

test("globs: globstar needs a path boundary, basename globs match at any depth", () => {
  const m = (glob: string, path: string) => new RegExp(globToRegex(glob)).test(path);
  assert.ok(m("src/**/test.ts", "src/test.ts"));
  assert.ok(m("src/**/test.ts", "src/a/b/test.ts"));
  assert.ok(!m("src/**/test.ts", "src/contest.ts"));
  assert.ok(m("*.ts", "a/b/c.ts"));
  assert.ok(m("*.ts", "c.ts"));
  assert.ok(!m("*.ts", "c.tsx"));
  assert.ok(!m("src/*.ts", "src/a/b.ts"));
  assert.ok(!m("src/*.ts", "x/src/b.ts"));
  assert.ok(m("**/*.md", "README.md"));
  assert.ok(m("a?c", "abc"));
});

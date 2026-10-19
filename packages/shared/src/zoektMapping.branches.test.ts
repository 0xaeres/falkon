import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, transformResponse, rankKnowledgeFirst, search, streamIR, setZoektTransport, type SearchResponse, type WSearchResponse } from "./zoekt";

const file: WSearchResponse["files"][number] = { file_name: Buffer.from("😀a.ts"), repository: "r", branches: ["main"], language: "TypeScript", chunk_matches: [] };

test("filename chunks, missing locations and symbol parents map independently of content chunks", () => {
  const result = transformResponse({ files: [{ ...file, chunk_matches: [
    { file_name: true, content: Buffer.alloc(0), ranges: [{ start: { column: 2 }, end: { column: 3 } }], symbol_info: [] },
    { file_name: false, content: Buffer.from("abc\n"), ranges: [{}], symbol_info: [{ sym: "a", kind: "method", parent: "C" }, { sym: "b", kind: "function" }] },
  ] }] }, Date.now());
  const f = result.files[0]!;
  assert.deepEqual(f.matches, [{ lineNumber: 0, text: "😀a.ts", ranges: [[2, 3]], fileNameMatch: true }, { lineNumber: 1, text: "abc", ranges: [[0, 0]], fileNameMatch: false }]);
  assert.deepEqual(f.chunks[0]!.symbols, [{ symbol: "a", kind: "method", parent: { symbol: "C", kind: "" } }, { symbol: "b", kind: "function" }]);
  assert.deepEqual(f.chunks[0]!.contentStart, { byteOffset: 0, lineNumber: 1, column: 1 });
  assert.equal(f.occurrences, 2);
  assert.equal(result.matchCount, 2);
  assert.equal(result.fileCount, 1);
  assert.equal(result.isSearchExhaustive, true);
  assert.equal(transformResponse({ files: [] }, 0).isSearchExhaustive, true);
});

test("request scope stays separate, nested revisions suppress HEAD and options pass through", () => {
  const scope = { repo: { regexp: "^allowed$" } };
  const query = { not: { child: { branch: { pattern: "dev", exact: false } } } };
  const request = buildRequest(query, { matches: 3.9, contextLines: 2 }, [scope]);
  assert.deepEqual(request.query, { and: { children: [query, scope] } });
  assert.deepEqual(request.opts, { chunk_matches: true, max_match_display_count: 3, total_max_match_count: 4, num_context_lines: 2, shard_max_match_count: -1, max_wall_time: { seconds: 0 } });
  assert.equal(buildRequest({ const: true }).opts.max_match_display_count, 5000);
});

test("knowledge ranking is stable within groups and does not alter counters", () => {
  const response = transformResponse({ files: [file, { ...file, repository: "a::knowledge" }, { ...file, repository: "second" }, { ...file, repository: "b::knowledge" }] }, 0);
  const ranked = rankKnowledgeFirst(response);
  assert.deepEqual(ranked.files.map((f) => f.repo), ["a::knowledge", "b::knowledge", "r", "second"]);
  assert.equal(ranked.fileCount, 4);
  assert.deepEqual(response.files.map((f) => f.repo), ["r", "a::knowledge", "second", "b::knowledge"]);
  const plain = transformResponse({ files: [file] }, 0);
  assert.equal(rankKnowledgeFirst(plain), plain);
});

test("search translates options and streaming preserves flush order and transport errors", async () => {
  const requests: unknown[] = [];
  setZoektTransport({
    search: async (req) => { requests.push(req); return { files: [file] }; },
    async *stream(req) { requests.push(req); yield { files: [file] }; yield { files: [], stats: { files_skipped: 1 } }; throw new Error("stream unavailable"); },
  });
  try {
    await search("context:web Needle", { regex: true, caseSensitive: true, contexts: { web: ["r"] }, matches: 2, scope: [{ repo: { regexp: "r" } }] });
    assert.deepEqual(requests[0], buildRequest({ and: { children: [{ repo_set: { set: { r: true } } }, { regexp: { regexp: "Needle", case_sensitive: true, file_name: false, content: true } }] } }, { matches: 2 }, [{ repo: { regexp: "r" } }]));
    const chunks: SearchResponse[] = [];
    await assert.rejects(async () => { for await (const chunk of streamIR({ const: true })) chunks.push(chunk); }, /stream unavailable/);
    assert.deepEqual(chunks.map((c) => [c.fileCount, c.isSearchExhaustive]), [[1, true], [0, false]]);
  } finally { setZoektTransport(undefined); }
});

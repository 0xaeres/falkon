import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { normalize } from "../../../tests/golden/normalize";
import { compareOutputs } from "../../../tests/golden/diff";

test("golden normalization removes timings, sorts unordered sets and keeps counts and exhaustiveness", () => {
  const a = { durationMs: 98, isSearchExhaustive: false, matchCount: 2, branches: ["main", "feature"], ranges: [[3, 4], [0, 1]] };
  const b = { durationMs: 2, isSearchExhaustive: false, matchCount: 2, branches: ["feature", "main"], ranges: [[0, 1], [3, 4]] };
  assert.deepEqual(normalize(a), normalize(b));
  const normalized = normalize(a) as Record<string, unknown>;
  assert.equal(normalized.durationMs, undefined);
  assert.equal(normalized.isSearchExhaustive, false);
  assert.equal(normalized.matchCount, 2);
  assert.notDeepEqual(normalize(a), normalize({ ...a, isSearchExhaustive: true }));
  assert.notDeepEqual(normalize(a), normalize({ ...a, matchCount: 1 }));
  assert.deepEqual(normalize({ content: [{ type: "text", text: "unchanged\n" }], values: [null, false, 0] }), { content: [{ text: "unchanged\n", type: "text" }], values: [null, false, 0] });
});

test("golden normalization canonicalizes file order but preserves matches, chunks and symbol order", () => {
  const file = { path: "z", matches: [{ lineNumber: 9 }, { lineNumber: 1 }], chunks: [{ content: "z" }, { content: "a" }], symbols: [{ symbol: "z" }, { symbol: "a" }] };
  const value = { files: [file, { path: "a" }] };
  assert.deepEqual(normalize(value), normalize({ files: [...value.files].reverse() }));
  assert.deepEqual((normalize(value) as { files: { path: string }[] }).files.map((f) => f.path), ["a", "z"]);
  const grep = (blocks: string[]) => ({ text: ["Found 2 matches in 2 files", ...blocks].join("\n\n") });
  assert.deepEqual(normalize(grep(["[r] b:\n  1: x", "[r] a:\n  1: x"])), normalize(grep(["[r] a:\n  1: x", "[r] b:\n  1: x"])));
  assert.notDeepEqual(normalize(grep(["[r] a:\n  1: x", "[r] b:\n  1: x"])), normalize(grep(["[r] a:\n  1: y", "[r] b:\n  1: x"])));
  for (const key of ["matches", "chunks", "symbols"] as const) {
    assert.notDeepEqual(normalize(value), normalize({ files: [{ ...file, [key]: [...file[key]].reverse() }, { path: "a" }] }), key);
  }
});

test("golden diff detects changed content, counts, missing queries and ordering in semantic arrays", () => {
  assert.equal(compareOutputs({ a: 1 }, { a: 1 }), "");
  for (const [before, after] of [[{ text: "old" }, { text: "new" }], [{ count: 1 }, { count: 2 }], [[{ id: "a" }], []], [{ values: [1, 2] }, { values: [2, 1] }]]) {
    assert.match(compareOutputs(before, after), /Golden output drift/);
  }
});

test("golden diff CLI returns zero for equal files and nonzero with a readable diff", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-golden-"));
  const script = new URL("../../../tests/golden/diff.ts", import.meta.url).pathname;
  const a = path.join(temp, "a.json"); const b = path.join(temp, "b.json");
  try {
    fs.writeFileSync(a, '{"text":"old"}'); fs.writeFileSync(b, '{"text":"old"}');
    execFileSync(process.execPath, ["--import", "tsx", script, a, b]);
    fs.writeFileSync(b, '{"text":"new"}');
    const changed = spawnSync(process.execPath, ["--import", "tsx", script, a, b], { encoding: "utf8" });
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Golden output drift/);
    assert.match(changed.stderr, /old/); assert.match(changed.stderr, /new/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("golden runner records API and MCP responses through mocked HTTP, including SSE and session teardown", async () => {
  const { runGolden } = await import("../../../tests/golden/run");
  process.env.MCP_PATH = "/mcp/fixtures";
  process.env.SEARCH_PATH = "/ui/products/fixtures/search";
  const requests: { url: URL; method: string; body?: any; headers: Headers }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method: init?.method ?? "GET", body, headers: new Headers(init?.headers) });
    if (url.pathname.endsWith("/search")) return Response.json({ durationMs: 99, files: [], fileCount: 0, matchCount: 0, isSearchExhaustive: true });
    if (init?.method === "DELETE" || body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }, { headers: { "mcp-session-id": "fixture-session" } });
    return new Response(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "No files found" }] } })}\r\n\r\n`, { headers: { "content-type": "text/event-stream" } });
  };
  const result = await runGolden("http://fixture.test", [{ id: "one", query: "Needle", regex: true, case: true, page: 2, limit: 1, repos: ["fixtures.test/atlas"], grep: { pattern: "Needle", repo: "fixtures.test/atlas" } }], request);
  assert.deepEqual(result, [{ id: "one", query: { id: "one", query: "Needle", regex: true, case: true, page: 2, limit: 1, repos: ["fixtures.test/atlas"], grep: { pattern: "Needle", repo: "fixtures.test/atlas" } }, search: { status: 200, body: { files: [], fileCount: 0, matchCount: 0, isSearchExhaustive: true } }, grep: { content: [{ type: "text", text: "No files found" }] } }]);
  const search = requests.find((req) => req.url.pathname.endsWith("/search"))!;
  assert.equal(search.url.searchParams.get("q"), "(Needle) reposet:fixtures.test/atlas");
  for (const [key, value] of [["regex", "1"], ["case", "1"], ["limit", "1"]]) assert.equal(search.url.searchParams.get(key!), value);
  assert.equal(search.url.searchParams.has("page"), false, "the api search route rejects unknown parameters");
  assert.deepEqual(requests.filter((req) => req.body).map((req) => req.body.method), ["initialize", "notifications/initialized", "tools/call"]);
  assert.equal(requests.at(-1)!.method, "DELETE");
  assert.equal(requests.at(-1)!.headers.get("mcp-session-id"), "fixture-session");
});

const queries = JSON.parse(fs.readFileSync(new URL("../../../tests/golden/queries.json", import.meta.url), "utf8")) as import("../../../tests/golden/run").GoldenQuery[];
const hasSyntax = (query: string, syntax: string) => new RegExp(`(?:^|[\\s(])${syntax.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${syntax === "or" ? "(?=$|[\\s)])" : ""}`).test(query);

test("golden coverage matches complete syntax tokens", () => {
  assert.equal(hasSyntax("repo:atlas", "or"), false);
  assert.equal(hasSyntax("-file:legacy", "file:"), false);
  assert.equal(hasSyntax("-repo:atlas", "repo:"), false);
  assert.equal(hasSyntax("(atlas or worker)", "or"), true);
  assert.equal(hasSyntax("(file:src)", "file:"), true);
});

test("golden set covers each syntax family and option with unique recording IDs", () => {
  assert.ok(queries.length >= 40);
  assert.equal(new Set(queries.map((q) => q.id)).size, queries.length);
  assert.ok(queries.some((q) => q.grep));
  for (const option of ["regex", "case", "page", "limit"]) assert.ok(queries.some((q) => Object.hasOwn(q, option)), option);
  for (const syntax of ["or", "-(", "-file:", "file:", "f:", "repo:", "r:", "rev:*", "lang:", "sym:", "content:", "c:", "reposet:", "archived:", "fork:", "visibility:"]) assert.ok(queries.some((q) => hasSyntax(q.query, syntax)), syntax);
});

const expected = new URL("../../../tests/golden/expected.json", import.meta.url);
test("recorded baseline holds every metadata-filter query as a successful search", {
  skip: fs.existsSync(expected) ? false : "No tests/golden/expected.json baseline; record it live with GOLDEN_RECORD=1 sh scripts/ops-smoke.sh",
}, () => {
  // The generic git connector writes zoekt.archived=0, zoekt.fork=0, zoekt.public=1 for every repo, so the
  // fixtures' own markers are inert and these filters record whatever the current engine returns. That output is the
  // frozen contract; it is not evidence the filters work on real archived/fork/private repos (named non-goal in baseline.md).
  const recorded = JSON.parse(fs.readFileSync(expected, "utf8")) as { id: string; search: { status: number } }[];
  for (const id of ["archived-only", "fork-only", "visibility-private", "visibility-public"]) {
    const entry = recorded.find((value) => value.id === id);
    assert.ok(entry, `Missing recorded query ${id}`);
    assert.equal(entry.search.status, 200, id);
  }
});

// Product isolation proof (ADR 0001 section 7; spec S4): the real Nest product listener in front of the real MCP
// handlers and tools, over two real git repositories, with the registry, repo rows and Zoekt faked (no database, no
// Zoekt in unit tests). Zoekt is a liar here: it returns hits from both repositories, so any hit outside the Product
// that reached a client would show the post-filter is missing.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { scopeFor, type WSearchRequest } from "@falkon/shared";
import { seedContractRepo } from "../../../tests/contract/fixture";

const fixture = seedContractRepo();
process.env.DATA_DIR = fixture.dir;
process.env.ZOEKT_URL = "invalid-isolation-url";
process.env.CONFIG_PATH = path.join(fixture.dir, "config.json");
for (const key of ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"]) delete process.env[key];

const IN = "fixtures.test/atlas";
const OUT = "fixtures.test/secret";
const MISSING = "fixtures.test/missing";
const SECRET_TEXT = "TOP_SECRET_MARKER";

/** A second repository with its own content, outside the Product. */
function seedSecretRepo() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-secret-"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "S", GIT_AUTHOR_EMAIL: "s@example.test", GIT_COMMITTER_NAME: "S", GIT_COMMITTER_EMAIL: "s@example.test" };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(work, "src"));
  fs.writeFileSync(path.join(work, "src", "hello.ts"), `export const greet = "${SECRET_TEXT}";\n`);
  git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", `secret ${SECRET_TEXT}`);
  fs.appendFileSync(path.join(work, "src", "hello.ts"), `// ${SECRET_TEXT} 2\n`);
  git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", `secret 2 ${SECRET_TEXT}`);
  const bare = path.join(fixture.dir, "repos", "secret.git");
  git("clone", "-q", "--bare", work, bare);
  return bare;
}
const secretBare = seedSecretRepo();
const row = (name: string, p: string) => ({ name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "refs/heads/main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: ["HEAD"], path: p });
const rows = [row(IN, fixture.bare), row(OUT, secretBare)];

const products: Record<string, { id: number; repoNames: string[] }> = { fx: { id: 1, repoNames: [IN] }, other: { id: 2, repoNames: [OUT] } };
const zoekt: WSearchRequest[] = [];
const loc = (column: number) => ({ byte_offset: column - 1, line_number: 1, column });
const hit = (repo: string, text: string) => ({ file_name: Buffer.from("src/hello.ts"), repository: repo, branches: ["HEAD"], language: "TypeScript", chunk_matches: [{ content: Buffer.from(`${text}\n`), content_start: loc(1), file_name: false, ranges: [{ start: loc(1), end: loc(6) }], symbol_info: [{ sym: "greet", kind: "function" }] }] });
const lyingZoekt = (req: WSearchRequest) => {
  zoekt.push(structuredClone(req));
  return { files: [hit(OUT, `greet ${SECRET_TEXT}`), hit(`${OUT}::knowledge`, `greet ${SECRET_TEXT}`), hit(IN, "greet hello")], stats: { match_count: 3, file_count: 3 } };
};

let app: INestApplication;
let base: string;
let fx: string;
before(async () => {
  const mcp = await import("./engine/mcp");
  const { toolDeps } = await import("./engine/tools");
  // web's sources load as CommonJS, so they hold the require()d instance of @falkon/shared: inject into that one.
  const { setZoektTransport } = await import("@falkon/shared");
  const { createApp } = await import("./app");
  toolDeps.baseUrl = "http://localhost:3000";
  mock.method(toolDeps, "getRepo", async (name: string) => rows.find((r) => r.name === name));
  mock.method(toolDeps, "listRepos", async ({ query }: { query?: string }) => rows.filter((r) => !query || r.name.includes(query.toLowerCase())));
  setZoektTransport({ search: async (r) => lyingZoekt(r), async *stream(r) { yield lyingZoekt(r); } });
  app = await createApp({ find: async (p) => (Object.hasOwn(products, p) ? structuredClone(products[p]) : undefined) }, { post: mcp.handleMcpPost, delete: mcp.handleMcpDelete });
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  fx = await openSession("fx");
});
after(async () => { await app.close(); mock.restoreAll(); fs.rmSync(fixture.dir, { recursive: true, force: true }); });

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const PROTOCOL = "2025-03-26";
let rpcId = 0;
const send = (product: string, body: unknown, session?: string) =>
  fetch(`${base}/mcp/${product}`, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session, "mcp-protocol-version": PROTOCOL } : {}) }, body: JSON.stringify(body) });
const payload = async (res: Response) => {
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text);
};
async function openSession(product: string) {
  const res = await send(product, { jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "isolation", version: "1" } } });
  assert.equal(res.status, 200);
  await res.text();
  const session = res.headers.get("mcp-session-id")!;
  await (await send(product, { jsonrpc: "2.0", method: "notifications/initialized" }, session)).text();
  return session;
}
/** A tool call's text and error flag through the Nest listener. */
async function call(session: string, name: string, args: Record<string, unknown>, product = "fx") {
  const res = await send(product, { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }, session);
  assert.equal(res.status, 200, `${name} ${JSON.stringify(args)}`);
  const r = (await payload(res)).result as { content: { text: string }[]; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: r.isError === true };
}


const repoNamedCalls = (repo: string): [string, Record<string, unknown>][] => [
  ["read_file", { repo, path: "src/hello.ts" }],
  ["list_tree", { repo }],
  ["list_commits", { repo }],
  ["list_branches", { repo }],
  ["get_diff", { repo, base: "HEAD~1", head: "HEAD" }],
  ["find_symbol_definitions", { repo, symbol: "greet" }],
  ["find_symbol_references", { repo, symbol: "greet" }],
  ["grep", { pattern: "greet", repo }],
  ["glob", { pattern: "**/*.ts", repo }],
];

test("P3: every repo-named argument gives an out-of-set repo exactly the result of a missing repo", async () => {
  for (const [[name, outArgs], [, missingArgs]] of repoNamedCalls(OUT).map((c, i) => [c, repoNamedCalls(MISSING)[i]!] as const)) {
    const out = await call(fx, name, outArgs);
    const missing = await call(fx, name, missingArgs);
    assert.equal(out.isError, true, name);
    assert.equal(out.text.replaceAll(OUT, "<repo>"), missing.text.replaceAll(MISSING, "<repo>"), name);
    assert.doesNotMatch(out.text, new RegExp(SECRET_TEXT), name);
  }
});

test("P3: the in-set repo still reads, so the denials above are not a broken fixture", async () => {
  const r = await call(fx, "read_file", { repo: IN, path: "src/hello.ts" });
  assert.equal(r.isError, false);
  assert.match(r.text, /hello world/);
  assert.equal((await call(fx, "list_commits", { repo: IN })).isError, false);
  assert.equal((await call(fx, "get_diff", { repo: IN, base: "HEAD~1", head: "HEAD" })).isError, false);
});

test("P3: hostile spellings of a repo name never resolve to the out-of-set repo", async () => {
  const names = [OUT.toUpperCase(), "Fixtures.test/secret", `${OUT}::knowledge`, `${OUT}-kb`, ` ${OUT}`, `${OUT} `, `${OUT}\u0000`, `${OUT}\n`, `${IN}/../secret`, `${IN}/../../${OUT}`, `fixtures.test/./secret`,
    "fixtures.test/*", "*", ".*", `${IN}|${OUT}`, `(${OUT})`, `^${OUT}$`, "--foo", "-n", "--upload-pack=touch /tmp/x", `${OUT}​`, "fixtures.test/sеcret", secretBare, `file://${secretBare}`];
  for (const repo of names) {
    for (const [name, args] of repoNamedCalls(repo)) {
      const r = await call(fx, name, args);
      assert.equal(r.isError, true, `${name} ${JSON.stringify(repo)}`);
      assert.doesNotMatch(r.text, new RegExp(SECRET_TEXT), `${name} ${JSON.stringify(repo)}`);
    }
  }
});

test("P3: list_repos and research_codebase list only the Product's repositories", async () => {
  const all = JSON.parse((await call(fx, "list_repos", {})).text);
  assert.deepEqual(all.repos.map((r: { name: string }) => r.name), [IN]);
  assert.equal(all.totalCount, 1);
  for (const query of ["secret", "SECRET", "fixtures.test/secret", "."]) {
    const r = JSON.parse((await call(fx, "list_repos", { query })).text);
    assert.equal(r.repos.some((x: { name: string }) => x.name === OUT), false, query);
  }
  const brief = await call(fx, "research_codebase", { query: "where is greet", repos: [OUT, IN] });
  assert.doesNotMatch(brief.text.split("Unavailable repositories")[0]!, /fixtures\.test\/secret/);
});

const scopeFilter = scopeFor([IN]).repoFilter!;
const andChildren = (q: unknown) => ((q as { and?: { children: unknown[] } }).and?.children ?? []) as { repo?: { regexp: string } }[];
const hasNode = (q: unknown, pred: (n: Record<string, unknown>) => boolean): boolean =>
  !!q && typeof q === "object" && (pred(q as Record<string, unknown>) || Object.values(q as object).some((v) => (Array.isArray(v) ? v.some((x) => hasNode(x, pred)) : hasNode(v, pred))));

test("P4: crafted search input cannot widen the Zoekt query, and out-of-set hits a lying Zoekt returns are dropped", async () => {
  const hostile = ["repo:fixtures.test/secret", `repo:${OUT}|${IN}`, "repo:a|b", "-repo:atlas", "x) or (repo:secret", "(?i)SECRET", ".*", `${OUT}`, "--foo", "-n", "\u0000", "r:secret", "repo:secret -repo:atlas", "\" or repo:.*"];
  const calls: [string, Record<string, unknown>][] = [];
  for (const h of hostile) {
    calls.push(["grep", { pattern: h }], ["grep", { pattern: "greet", path: h }], ["grep", { pattern: "greet", include: h }], ["grep", { pattern: "greet", ref: h }], ["grep", { pattern: "greet", groupByRepo: true, path: h }]);
    calls.push(["glob", { pattern: h }], ["glob", { pattern: "**/*.ts", path: h }], ["glob", { pattern: "*", ref: h }]);
    calls.push(["find_symbol_definitions", { symbol: h, repo: IN }], ["find_symbol_references", { symbol: h, repo: IN }]);
  }
  const rejected: string[] = [];
  for (const [name, args] of calls) {
    zoekt.length = 0;
    const r = await call(fx, name, args);
    // hits are printed as `[repo] path` (grep), `[repo]` (glob) or `  repo: n matches` (groupByRepo); outputs may echo the input
    assert.doesNotMatch(r.text, new RegExp(`${SECRET_TEXT}|\\[fixtures\\.test/secret|^\\s+fixtures\\.test/secret`, "m"), `${name} ${JSON.stringify(args)}`);
    if (zoekt.length === 0) {
      // rejected before any search (e.g. an invalid regexp): fine, as long as it is an error
      assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} neither searched nor failed`);
      rejected.push(`${name} ${JSON.stringify(args)} => ${r.text.slice(0, 200)}`);
    }
    for (const req of zoekt) {
      // The Product filter is its own direct child of the top-level AND: no user text sits above it.
      assert.equal(andChildren(req.query).filter((c) => c.repo?.regexp === scopeFilter).length, 1, `${name} ${JSON.stringify(args)} ${JSON.stringify(req.query)}`);
      assert.equal(hasNode(req.query, (n) => "or" in n || "not" in n), false, `${name}: user text built an OR/NOT node`);
    }
  }
  // positive control: the in-set hit from the same lying Zoekt does come through
  assert.match((await call(fx, "grep", { pattern: "greet" })).text, /\[fixtures\.test\/atlas\] src\/hello\.ts/);
  assert.match((await call(fx, "grep", { pattern: "greet", groupByRepo: true })).text, /^\s+fixtures\.test\/atlas: /m);
  assert.ok(rejected.length < calls.length / 4, `most hostile inputs reach the search: ${rejected.join("; ")}`);
});

test("P4: the scope filter admits the Product's repo and its knowledge repo only", () => {
  const re = new RegExp(scopeFilter);
  assert.ok(re.test(IN) && re.test(`${IN}::knowledge`));
  for (const name of [OUT, `${OUT}::knowledge`, `${IN}x`, `x${IN}`, `${IN}::knowledgex`, "fixtures.test/atlas2"]) assert.equal(re.test(name), false, name);
});

test("P5: path and ref traversal and option injection on an in-set repo are still rejected", async () => {
  const marker = path.join(fixture.dir, "pwned");
  const cases: [string, Record<string, unknown>][] = [
    ["read_file", { repo: IN, path: "../secret.git/HEAD" }],
    ["read_file", { repo: IN, path: "src/../../secret.git/config" }],
    ["read_file", { repo: IN, path: "src/hello.ts\u0000" }],
    ["read_file", { repo: IN, path: "src/hello.ts", ref: `--output=${marker}` }],
    ["read_file", { repo: IN, path: "src/hello.ts", ref: "-n" }],
    ["list_tree", { repo: IN, ref: `--output=${marker}` }],
    ["list_tree", { repo: IN, path: "../.." }],
    ["list_commits", { repo: IN, ref: `--output=${marker}` }],
    ["list_commits", { repo: IN, ref: "--all" }],
    ["get_diff", { repo: IN, base: `--output=${marker}`, head: "HEAD" }],
    ["get_diff", { repo: IN, base: "HEAD", head: "--no-index" }],
  ];
  for (const [name, args] of cases) {
    const r = await call(fx, name, args);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
    assert.doesNotMatch(r.text, new RegExp(SECRET_TEXT));
  }
  // option-like values in non-ref fields stay values (`--author=…`, `--grep=…`, after `--`)
  for (const args of [{ author: "--all" }, { query: "--all" }, { path: "--all" }, { path: "../secret.git" }]) {
    const r = await call(fx, "list_commits", { repo: IN, ...args });
    assert.doesNotMatch(r.text, new RegExp(SECRET_TEXT), JSON.stringify(args));
  }
  assert.equal(fs.existsSync(marker), false, "no git option was injected");
});

test("P11: concurrent sessions on two Products stay isolated, and a session replayed under the other Product starts nothing", async () => {
  const other = await openSession("other");
  const [a, b] = await Promise.all([call(fx, "list_repos", {}), call(other, "list_repos", {}, "other")]);
  assert.deepEqual(JSON.parse(a.text).repos.map((r: { name: string }) => r.name), [IN]);
  assert.deepEqual(JSON.parse(b.text).repos.map((r: { name: string }) => r.name), [OUT]);
  const [ra, rb] = await Promise.all([call(fx, "read_file", { repo: OUT, path: "src/hello.ts" }), call(other, "read_file", { repo: IN, path: "src/hello.ts" }, "other")]);
  assert.equal(ra.isError && rb.isError, true);
  // replay fx's session id under /mcp/other, with a tool call and with an initialize request
  for (const body of [
    { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "read_file", arguments: { repo: OUT, path: "src/hello.ts" } } },
    { jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "replay", version: "1" } } },
  ]) {
    const res = await send("other", body, fx);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("mcp-session-id"), null, "no session was opened in its place");
    assert.deepEqual(await res.json(), { statusCode: 404, errorCode: "NOT_FOUND", message: "Session not found." });
  }
  // an id the boundary never bound, with an initialize body, would open a session in mcp.ts; the boundary stops it
  const forged = await send("fx", { jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "forged", version: "1" } } }, "forged-id");
  assert.equal(forged.status, 404);
  assert.equal(forged.headers.get("mcp-session-id"), null);
  assert.equal((await call(fx, "list_repos", {})).isError, false, "the original session is untouched");
});

test("P11: a membership change rejects the open session (no widening through an old session) and a new session sees the new set", async () => {
  const session = await openSession("fx");
  products.fx!.repoNames = [IN, OUT];
  try {
    const stale = await send("fx", { jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "list_repos", arguments: {} } }, session);
    assert.equal(stale.status, 404);
    await stale.text();
    const fresh = await openSession("fx");
    assert.deepEqual(JSON.parse((await call(fresh, "list_repos", {})).text).repos.map((r: { name: string }) => r.name), [IN, OUT]);
    products.fx!.repoNames = [IN];
    assert.equal((await send("fx", { jsonrpc: "2.0", id: ++rpcId, method: "tools/list" }, fresh)).status, 404, "narrowing rejects too");
  } finally { products.fx!.repoNames = [IN]; }
});

// ---- P12: the pull request history tools (MCP_HISTORY_TOOLS=on) through the real Product listener ----

test("P12: history tools exist only with the flag, and the Product's repository set bounds every read", async () => {
  const { toolDeps } = await import("./engine/tools");
  const { fakeProvenanceStore } = await import("../../shared/src/provenance.fake");
  const store = fakeProvenanceStore({ [IN]: 1, [OUT]: 2 });
  const ok = { cursorUpdatedAt: null, lastRunAt: null, lastSuccessAt: new Date("2025-02-01T00:00:00Z"), headCommit: null, status: "ok" as const, error: null, importedCount: 1, skippedCount: 0, access: "ok" as const, waitUntil: null, reconciledAt: null };
  const d = (title: string) => ({ kind: "PR" as const, number: 7, title, body: SECRET_TEXT, state: "merged" as const, authorLogin: "dev", createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-02"), mergedAt: null, closedAt: null, mergeCommitSha: null, headRef: null, baseRef: null, url: null, labels: [], truncated: [], comments: [], files: [] });
  await store.saveSyncState(1, ok);
  await store.saveSyncState(2, ok);
  await store.replaceDiscussion(1, d("in-set seven"), [{ fromKind: "pr", fromRef: "7", toKind: "pr", toRef: "7", toRepo: OUT, source: "body-ref", verified: true }, { fromKind: "pr", fromRef: "7", toKind: "ticket", toRef: "TRUNK-1", toRepo: null, source: "ticket-pattern", verified: true }]);
  await store.replaceDiscussion(2, d("outside seven"), [{ fromKind: "pr", fromRef: "7", toKind: "ticket", toRef: "TRUNK-1", toRepo: null, source: "ticket-pattern", verified: true }]);
  const before = toolDeps.history, flag = process.env.MCP_HISTORY_TOOLS;
  toolDeps.history = store;
  try {
    delete process.env.MCP_HISTORY_TOOLS;
    const off = await openSession("fx");
    const names = async (session: string) => ((await payload(await send("fx", { jsonrpc: "2.0", id: ++rpcId, method: "tools/list" }, session))).result.tools as { name: string }[]).map((t) => t.name);
    assert.ok(!(await names(off)).includes("get_pull_request"), "flag off: not listed");
    assert.equal((await call(off, "get_pull_request", { repo: IN, number: 7 })).isError, true, "flag off: not callable");

    process.env.MCP_HISTORY_TOOLS = "on";
    const on = await openSession("fx");
    assert.deepEqual((await names(on)).slice(-3), ["get_pull_request", "search_discussions", "get_provenance"]);

    // an out-of-set repository gives exactly what a missing one gives, for every history tool and anchor
    const pairs: [string, (repo: string) => Record<string, unknown>][] = [
      ["get_pull_request", (repo) => ({ repo, number: 7 })],
      ["search_discussions", (repo) => ({ query: "seven", repo })],
      ["get_provenance", (repo) => ({ repo, pr: 7 })],
      ["get_provenance", (repo) => ({ repo, ticket: "TRUNK-1" })],
      ["get_provenance", (repo) => ({ repo, path: "src/hello.ts" })],
    ];
    for (const [name, args] of pairs) {
      const out = await call(on, name, args(OUT));
      const missing = await call(on, name, args(MISSING));
      assert.equal(out.isError, true, name);
      assert.equal(out.text.replaceAll(OUT, "<repo>"), missing.text.replaceAll(MISSING, "<repo>"), name);
      assert.doesNotMatch(out.text, new RegExp(`${SECRET_TEXT}|outside seven`), name);
    }

    // unrestricted reads never carry the other Product's rows or links
    const everything = [
      await call(on, "search_discussions", { query: "seven" }),
      await call(on, "search_discussions", { query: "TRUNK-1" }),
      await call(on, "search_discussions", { query: "#7" }),
      await call(on, "get_provenance", { ticket: "TRUNK-1" }),
      await call(on, "get_provenance", { repo: IN, pr: 7 }),
      await call(on, "get_pull_request", { repo: IN, number: 7 }),
    ];
    for (const r of everything) {
      assert.equal(r.isError, false, r.text);
      assert.doesNotMatch(r.text, new RegExp(`${OUT}|outside seven`), r.text);
    }
    assert.deepEqual(JSON.parse(everything[0]!.text).hits.map((h: { repo: string }) => h.repo), [IN]);
    assert.deepEqual(JSON.parse(everything[4]!.text).pullRequests, [], "the link into the other Product is dropped");

    // the other Product sees only its own
    const other = await openSession("other");
    assert.deepEqual(JSON.parse((await call(other, "search_discussions", { query: "seven" }, "other")).text).hits.map((h: { repo: string }) => h.repo), [OUT]);
  } finally {
    toolDeps.history = before;
    if (flag === undefined) delete process.env.MCP_HISTORY_TOOLS; else process.env.MCP_HISTORY_TOOLS = flag;
  }
});

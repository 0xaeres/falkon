import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scopeFor } from "./access";
import { toolJsonSchema } from "./toolJsonSchema";
import { historyToolDefinitions, historyToolNames } from "./historyTools";
import { fakeProvenanceStore } from "./provenance.fake";
import { pr } from "./provenance.contract";
import { MAX_OFFSET, type Discussion, type Link, type ProvenanceStore } from "./provenance";
import type { ToolContext, ToolDeps, ToolRepo } from "./tools";

const APP = "github.com/acme/app", LIB = "github.com/acme/lib", SECRET = "github.com/other/secret", NEVER = "github.com/acme/never";
const ids: Record<string, number> = { [APP]: 1, [LIB]: 2, [SECRET]: 3, [NEVER]: 4 };
const MAX_BYTES = 24_000;
const t = (s: string) => new Date(s);

let dir: string, sha1: string, sha2: string, store: ProvenanceStore;

const row = (name: string, p: string): ToolRepo => ({ id: ids[name], name, displayName: null, codeHostType: "github", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: p });
const ctx = (...patterns: string[]): ToolContext => {
  const repos = Object.keys(ids).map((n) => row(n, dir));
  const deps: ToolDeps = { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, baseUrl: "http://x", history: store };
  return { deps, scope: scopeFor(patterns.length ? patterns : [APP, LIB, NEVER]) };
};
const tools = historyToolDefinitions;
const run = async <N extends keyof typeof tools>(name: N, args: Record<string, unknown>, c = ctx()) => {
  const d = tools[name] as unknown as { inputSchema: { parse(a: unknown): unknown }; execute(a: unknown, c: ToolContext): Promise<{ output: string }> };
  const { output } = await d.execute(d.inputSchema.parse(args), c);
  return { text: output, json: JSON.parse(output) as any };
};
const rejects = (name: keyof typeof tools, args: Record<string, unknown>) => assert.rejects(() => run(name, args));
const comment = (i: number, body: string, o: Partial<Discussion["comments"][number]> = {}) => ({ externalId: String(i), kind: "issue_comment" as const, authorLogin: "rev", body, state: null, path: null, line: null, createdAt: new Date(Date.UTC(2025, 0, 2, 0, 0, i)), updatedAt: null, ...o });
const ticket = (n: number, key: string): Link => ({ fromKind: "pr", fromRef: String(n), toKind: "ticket", toRef: key, toRepo: null, source: "ticket-pattern", verified: true });
const commitLink = (sha: string, n: number, o: Partial<Link> = {}): Link => ({ fromKind: "commit", fromRef: sha, toKind: "pr", toRef: String(n), toRepo: null, source: "squash-subject", verified: true, ...o });
const ok = { cursorUpdatedAt: t("2025-01-09T00:00:00Z"), lastRunAt: t("2025-02-01T00:00:00Z"), lastSuccessAt: t("2025-02-01T00:00:00Z"), headCommit: "abc", status: "ok" as const, error: null, importedCount: 1, skippedCount: 0 };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-history-"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "F", GIT_AUTHOR_EMAIL: "f@example.test", GIT_COMMITTER_NAME: "F", GIT_COMMITTER_EMAIL: "f@example.test" };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, env, stdio: "pipe" }).toString().trim();
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.ts"), "one\ntwo\nthree\nfour\n");
  git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "initial");
  sha1 = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "a.ts"), "one\nTWO\nthree\nfour\n");
  git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "tweak the second line (#12)");
  sha2 = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "b.ts"), "unrelated\n");
  git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "add b");
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function seed() {
  store = fakeProvenanceStore(ids);
  for (const r of [APP, LIB, SECRET]) await store.saveSyncState(ids[r]!, ok);
}

// ---- registration shape ----

test("history tools are their own registry, named and described with every parameter", () => {
  assert.deepEqual(historyToolNames, ["get_pull_request", "search_discussions", "get_provenance"]);
  for (const n of historyToolNames) {
    const d = tools[n] as unknown as { description: string; inputSchema: { shape: object }; isReadOnly: boolean };
    assert.ok(d.isReadOnly);
    for (const param of Object.keys(d.inputSchema.shape)) assert.ok(d.description.includes(param), `${n}: ${param}`);
    assert.match(d.description, /untrusted/i, `${n} flags pull request text as untrusted`);
  }
  assert.match(tools.get_provenance.description, /\(#N\)/);
});

// ---- get_pull_request ----

test("get_pull_request: fields, linked tickets and verified commits, files, comments with review position", async () => {
  await seed();
  const d = pr(12, { title: "Tweak", body: "Fixes TRUNK-1", mergeCommitSha: sha2, labels: ["x"], files: [{ path: "a.ts", additions: 1, deletions: 1 }],
    comments: [comment(1, "looks good"), comment(2, "nit", { kind: "review_comment", path: "a.ts", line: 2 })] });
  await store.replaceDiscussion(ids[APP], d, [ticket(12, "TRUNK-1")]);
  await store.replaceCommitLinks(ids[APP], [commitLink(sha2, 12), commitLink("f".repeat(40), 12, { verified: false })]);
  const { json } = await run("get_pull_request", { repo: APP, number: 12 });
  assert.equal(json.repo, APP);
  assert.deepEqual([json.number, json.kind, json.title, json.state, json.author, json.mergeCommit, json.url], [12, "pr", "Tweak", "merged", "dev", sha2, "https://example.test/pull/12"]);
  assert.deepEqual([json.createdAt, json.mergedAt, json.closedAt], ["2025-01-01T00:00:00.000Z", "2025-01-02T00:00:00.000Z", "2025-01-02T00:00:00.000Z"]);
  assert.deepEqual(json.tickets, [{ key: "TRUNK-1", source: "ticket-pattern" }]);
  assert.deepEqual(json.commits, [{ sha: sha2, source: "squash-subject", verified: true }], "unverified links are hidden");
  assert.deepEqual(json.files, [{ path: "a.ts", additions: 1, deletions: 1 }]);
  assert.deepEqual(json.comments.map((c: any) => [c.kind, c.path, c.line, c.body]), [["issue_comment", null, null, "looks good"], ["review_comment", "a.ts", 2, "nit"]]);
  assert.equal(json.nextOffset, null);
  assert.equal(json.body, "Fixes TRUNK-1");
  assert.deepEqual(json.truncated, []);
  assert.equal(json.syncedAt, "2025-02-01T00:00:00.000Z");
});

test("get_pull_request: zero comments, includeComments=false, and offset beyond the end", async () => {
  await seed();
  await store.replaceDiscussion(ids[APP], pr(1), []);
  await store.replaceDiscussion(ids[APP], pr(2, { comments: [comment(1, "a"), comment(2, "b")] }), []);
  assert.deepEqual([(await run("get_pull_request", { repo: APP, number: 1 })).json.comments, (await run("get_pull_request", { repo: APP, number: 1 })).json.nextOffset], [[], null]);
  const off = (await run("get_pull_request", { repo: APP, number: 2, includeComments: false })).json;
  assert.equal(off.comments, undefined);
  assert.equal(off.nextOffset, null);
  const past = (await run("get_pull_request", { repo: APP, number: 2, offset: 99 })).json;
  assert.deepEqual([past.comments, past.nextOffset], [[], null]);
});

test("get_pull_request: more comments than a page are paged by offset, each cut at 2000 characters and said so", async () => {
  await seed();
  const comments = Array.from({ length: 120 }, (_, i) => comment(i, i === 0 ? "x".repeat(5000) : `c${i}`));
  await store.replaceDiscussion(ids[APP], pr(3, { comments }), []);
  const first = (await run("get_pull_request", { repo: APP, number: 3 })).json;
  assert.equal(first.comments.length, 50);
  assert.equal(first.nextOffset, 50);
  assert.equal(first.comments[0].body.length, 2000);
  assert.ok(first.truncated.some((x: string) => /comment text .*2000/.test(x)));
  const last = (await run("get_pull_request", { repo: APP, number: 3, offset: 100 })).json;
  assert.deepEqual([last.comments.length, last.nextOffset], [20, null]);
});

test("get_pull_request: store caps and stored truncation are reported, never silent", async () => {
  await seed();
  const comments = Array.from({ length: 520 }, (_, i) => comment(i, "c"));
  const files = Array.from({ length: 520 }, (_, i) => ({ path: `f${String(i).padStart(3, "0")}`, additions: 1, deletions: 0 }));
  await store.replaceDiscussion(ids[APP], pr(4, { comments, files, truncated: ["reviews", "body"] }), []);
  const { json } = await run("get_pull_request", { repo: APP, number: 4 });
  assert.equal(json.files.length, 100);
  const flat = json.truncated.join("\n");
  for (const re of [/files.*100/, /comments.*500/, /files.*500/, /reviews/, /body/]) assert.match(flat, re);
});

test("get_pull_request: a huge body and huge comments keep the output within the size bound", async () => {
  await seed();
  const comments = Array.from({ length: 80 }, (_, i) => comment(i, "é".repeat(5000)));
  const files = Array.from({ length: 200 }, (_, i) => ({ path: "dir/".repeat(100) + i, additions: 1, deletions: 1 }));
  await store.replaceDiscussion(ids[APP], pr(5, { body: "漢".repeat(60000), comments, files }), [ticket(5, "TRUNK-1")]);
  const { text, json } = await run("get_pull_request", { repo: APP, number: 5 });
  assert.ok(Buffer.byteLength(text) <= MAX_BYTES, `${Buffer.byteLength(text)} bytes`);
  assert.ok(json.body.length <= 8000);
  assert.match(json.truncated.join("\n"), /body/);
  assert.ok(json.comments.length >= 1);
  assert.ok(json.nextOffset === null || json.nextOffset === json.comments.length, "paging resumes where the cut stopped");
});

test("get_pull_request: missing, out-of-Product and never-imported repositories", async () => {
  await seed();
  await store.replaceDiscussion(ids[SECRET], pr(1, { title: "secret plan" }), []);
  const missing = await run("get_pull_request", { repo: "github.com/acme/none", number: 1 }).catch((e: Error) => e);
  const outside = await run("get_pull_request", { repo: SECRET, number: 1 }).catch((e: Error) => e);
  assert.ok(missing instanceof Error && outside instanceof Error);
  assert.equal(outside.message, `Repository "${SECRET}" not found.`);
  assert.equal(outside.message, missing.message.replace("github.com/acme/none", SECRET));
  assert.deepEqual((await run("get_pull_request", { repo: NEVER, number: 1 })).json, { repo: NEVER, number: 1, coverageGaps: [`pull requests not ingested for ${NEVER}`] });
  await assert.rejects(run("get_pull_request", { repo: APP, number: 77 }), /Pull request #77 not found in "github.com\/acme\/app"/);
});

test("get_pull_request: the schema rejects zero, negative, fractional numbers, bad offsets and unknown keys", async () => {
  for (const args of [{ number: 0 }, { number: -1 }, { number: 1.5 }, { number: 1, offset: -1 }, { number: 1, offset: 0.5 }, { number: 1, extra: 1 }, { number: "1" }])
    await rejects("get_pull_request", { repo: APP, ...args });
  await rejects("get_pull_request", { number: 1 });
});

// ---- search_discussions ----

async function seedSearch() {
  await seed();
  await store.replaceDiscussion(ids[APP], pr(1, { title: "Fix Login redirect", body: "Users saw 100% failures. It's the O'Brien case, a_b.", mergeCommitSha: sha2, headRef: "feature", comments: [comment(1, "the REDIRECT loops forever")] }), [ticket(1, "TRUNK-6670")]);
  await store.replaceDiscussion(ids[APP], pr(2, { title: "Other", headRef: "login-cache", state: "open", mergedAt: null, kind: "ISSUE" }), []);
  await store.replaceDiscussion(ids[LIB], pr(3, { title: "login only" }), []);
  await store.replaceDiscussion(ids[SECRET], pr(4, { title: "secret login plan" }), [ticket(4, "TRUNK-6670")]);
}

test("search_discussions: words ANDed case-insensitively, matchedIn, snippets, repositories never imported as gaps", async () => {
  await seedSearch();
  const { json } = await run("search_discussions", { query: "LOGIN redirect" });
  assert.deepEqual(json.hits.map((h: any) => `${h.repo}#${h.number}`), [`${APP}#1`]);
  const h = json.hits[0];
  assert.deepEqual([h.kind, h.title, h.state, h.mergeCommit, h.matchedIn.sort()], ["pr", "Fix Login redirect", "merged", sha2, ["comment", "title"]]);
  assert.ok(h.snippets.length >= 1 && h.snippets.length <= 3 && h.snippets.every((s: any) => s.text.length <= 300));
  assert.deepEqual([json.totalCount, json.totalCapped, json.hasMore], [1, false, false]);
  assert.deepEqual(json.coverageGaps, [`pull requests not ingested for ${NEVER}`]);
  const branch = (await run("search_discussions", { query: "login-cache" })).json.hits[0];
  assert.deepEqual([branch.number, branch.matchedIn], [2, ["branch"]]);
});

test("search_discussions: never returns rows from outside the Product, even by exact ticket key", async () => {
  await seedSearch();
  const all = (await run("search_discussions", { query: "login" })).json;
  assert.ok(all.hits.every((h: any) => h.repo !== SECRET));
  assert.equal(all.totalCount, 3);
  assert.deepEqual((await run("search_discussions", { query: "TRUNK-6670" })).json.hits.map((h: any) => h.repo), [APP]);
  await assert.rejects(run("search_discussions", { query: "login", repo: SECRET }), { message: `Repository "${SECRET}" not found.` });
});

test("search_discussions: a repo filter, kind, state and date filters", async () => {
  await seedSearch();
  const nums = async (a: Record<string, unknown>) => (await run("search_discussions", { query: "login", ...a })).json.hits.map((h: any) => h.number).sort();
  assert.deepEqual(await nums({ repo: LIB }), [3]);
  assert.deepEqual(await nums({ kind: "issue" }), [2]);
  assert.deepEqual(await nums({ kind: "pr" }), [1, 3]);
  assert.deepEqual(await nums({ state: "open" }), [2]);
  assert.deepEqual(await nums({ since: "2025-01-02", until: "2025-12-31" }), []);
  assert.deepEqual(await nums({ since: "2025-01-01", until: "2025-01-01T00:00:00Z" }), [1, 2, 3]);
});

test("search_discussions: a ticket key and #N match exactly", async () => {
  await seedSearch();
  assert.deepEqual((await run("search_discussions", { query: "trunk-6670" })).json.hits.map((h: any) => [h.number, h.matchedIn]), [[1, ["ticket"]]]);
  assert.deepEqual((await run("search_discussions", { query: "TRUNK-66" })).json.hits, [], "no prefix match for a key-shaped query without a linked ticket or text");
  const n = (await run("search_discussions", { query: "#3" })).json;
  assert.deepEqual(n.hits.map((h: any) => [h.repo, h.number, h.matchedIn]), [[LIB, 3, ["number"]]]);
  assert.deepEqual((await run("search_discussions", { query: "#3", repo: APP })).json.hits, []);
  assert.deepEqual((await run("search_discussions", { query: "#4" })).json.hits, [], "the number exists only in an outside repository");
  assert.deepEqual(n.coverageGaps, [`pull requests not ingested for ${NEVER}`]);
});

test("search_discussions: LIKE characters, quotes and a long query are literal and bounded", async () => {
  await seedSearch();
  const hits = async (query: string) => (await run("search_discussions", { query })).json;
  assert.deepEqual((await hits("100%")).hits.map((h: any) => h.number), [1]);
  assert.deepEqual((await hits("%")).hits.map((h: any) => h.number), [1]);
  assert.deepEqual((await hits("a_b")).hits.map((h: any) => h.number), [1]);
  assert.deepEqual((await hits("a%b")).hits, []);
  assert.deepEqual((await hits("O'Brien")).hits.map((h: any) => h.number), [1]);
  assert.deepEqual((await hits(`"; DROP TABLE "Discussion"; --`)).hits, []);
  const long = await hits(("word ".repeat(40) + "x".repeat(500)).trim());
  assert.deepEqual(long.hits, []);
  assert.match(long.truncated.join("\n"), /query .*8 words/);
});

test("search_discussions: a multi-word query with no all-words hit gets a hint and up to 5 partial matches", async () => {
  await seed();
  await store.replaceDiscussion(ids[APP], pr(1, { title: "Patient search should bypass service worker caching", updatedAt: t("2025-03-01T00:00:00Z") }), []);
  await store.replaceDiscussion(ids[LIB], pr(2, { title: "slow render", updatedAt: t("2025-04-01T00:00:00Z") }), []);
  await store.replaceDiscussion(ids[SECRET], pr(3, { title: "service worker slow" }), []);
  const { json } = await run("search_discussions", { query: "service worker patient search slow" });
  assert.equal(json.totalCount, 0);
  assert.deepEqual(json.hits, []);
  assert.match(json.hint, /all words are required/);
  assert.deepEqual(json.partialMatches.map((m: any) => [m.repo, m.number, m.title, m.matchedWords]), [
    [LIB, 2, "slow render", ["slow"]],
    [APP, 1, "Patient search should bypass service worker caching", ["service", "worker", "patient", "search"]],
  ], "newest first, outside repository never shown");
  const scoped = (await run("search_discussions", { query: "service worker patient search slow", repo: APP })).json;
  assert.deepEqual(scoped.partialMatches.map((m: any) => m.repo), [APP]);
});

test("search_discussions: no hint for one word, for a hit, or for ticket and #N shapes", async () => {
  await seedSearch();
  for (const query of ["zzzz", "TRUNK-1", "#99"]) {
    const j = (await run("search_discussions", { query })).json;
    assert.deepEqual([j.hint, j.partialMatches], [undefined, undefined], query);
  }
  const hit = (await run("search_discussions", { query: "login redirect" })).json;
  assert.deepEqual([hit.hint, hit.partialMatches], [undefined, undefined]);
});

test("search_discussions: partial matches cap at 5, words cap at 8, every word matching a different pull request", async () => {
  await seed();
  const ws = ["aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh", "ii"];
  for (const [i, w] of ws.entries()) await store.replaceDiscussion(ids[APP], pr(i + 1, { title: w }), []);
  const j = (await run("search_discussions", { query: ws.join(" ") })).json;
  assert.equal(j.partialMatches.length, 5);
  assert.ok(j.partialMatches.every((m: any) => m.matchedWords.length === 1));
  assert.match(j.truncated.join("\n"), /8 words/);
  assert.ok(!j.partialMatches.some((m: any) => m.title === "ii"), "the ninth word is cut");
});

test("search_discussions: a timeout in the fallback keeps the hint and says so in truncated", async () => {
  await seed();
  const real = store;
  store = { ...real, search: async (n, q) => (q.any ? { hits: [], hasMore: false, gaps: [], timedOut: true, total: 0, totalCapped: false } : real.search(n, q)) };
  const j = (await run("search_discussions", { query: "alpha beta" })).json;
  store = real;
  assert.match(j.hint, /all words are required/);
  assert.deepEqual(j.partialMatches, []);
  assert.match(j.truncated.join("\n"), /timed out/);
});

test("search_discussions: empty or blank queries and out-of-range paging are rejected", async () => {
  await seedSearch();
  await rejects("search_discussions", { query: "" });
  await assert.rejects(run("search_discussions", { query: "   " }), /at least one word/);
  for (const a of [{ perPage: 21 }, { perPage: 0 }, { page: 0 }, { page: -1 }, { page: 1.5 }, { kind: "all2" }, { since: "yesterday" }, { query: "x".repeat(2001) }])
    await rejects("search_discussions", { query: "login", ...a });
});

test("search_discussions: pages, totalCount capped at 1000 and flagged", async () => {
  await seed();
  for (let i = 1; i <= MAX_OFFSET + 50; i++) await store.replaceDiscussion(ids[LIB], pr(i, { title: "needle" }), []);
  const p1 = (await run("search_discussions", { query: "needle", perPage: 20 })).json;
  assert.deepEqual([p1.hits.length, p1.totalCount, p1.totalCapped, p1.hasMore, p1.page], [20, MAX_OFFSET, true, true, 1]);
  const p3 = (await run("search_discussions", { query: "needle", perPage: 20, page: 3 })).json;
  assert.equal(p3.page, 3);
  assert.notDeepEqual(p3.hits.map((h: any) => h.number), p1.hits.map((h: any) => h.number));
});

test("search_discussions: 20 long hits stay inside the size bound and say snippets were reduced", async () => {
  await seed();
  for (let i = 1; i <= 20; i++) await store.replaceDiscussion(ids[APP], pr(i, { title: "needle " + "t".repeat(300), body: ("needle " + "b".repeat(400)).repeat(3), comments: [comment(1, "needle " + "c".repeat(900)), comment(2, "needle again")] }), []);
  const { text, json } = await run("search_discussions", { query: "needle" });
  assert.equal(json.hits.length, 20);
  assert.ok(Buffer.byteLength(text) <= MAX_BYTES, `${Buffer.byteLength(text)} bytes`);
  assert.ok(json.hits.every((h: any) => h.snippets.length <= 3 && h.snippets.every((s: any) => s.text.length <= 300)));
});

// ---- get_provenance ----

test("get_provenance: exactly one anchor, with its companions", async () => {
  await seed();
  for (const args of [{}, { repo: APP, commit: sha2, pr: 1 }, { ticket: "A-1", pr: 1, repo: APP }, { repo: APP, path: "a.ts", commit: sha2 }, { repo: APP, startLine: 1, endLine: 2 }])
    await assert.rejects(run("get_provenance", args), /exactly one of commit, pr, ticket or path/);
  for (const args of [{ pr: 1 }, { path: "a.ts" }, { repo: APP, path: "a.ts", startLine: 3, endLine: 2 }, { repo: APP, path: "a.ts", startLine: 3 }, { repo: APP, path: "a.ts", startLine: 0, endLine: 1 }, { repo: APP, pr: 0 }, { commit: "xyz" }])
    await rejects("get_provenance", args);
});

test("get_provenance: commit, pr and ticket anchors return linked kinds with source and verified flag", async () => {
  await seed();
  await store.replaceDiscussion(ids[APP], pr(12, { mergeCommitSha: sha2 }), [ticket(12, "TRUNK-1"), { fromKind: "pr", fromRef: "12", toKind: "pr", toRef: "9", toRepo: LIB, source: "body-ref", verified: true }]);
  await store.replaceCommitLinks(ids[APP], [commitLink(sha2, 12), commitLink(sha1, 12, { source: "merge-commit-sha", verified: false })]);
  const byCommit = (await run("get_provenance", { commit: sha2.toUpperCase() })).json;
  assert.deepEqual(byCommit.pullRequests, [{ repo: APP, number: 12, source: "squash-subject", verified: true }]);
  assert.deepEqual([byCommit.commits, byCommit.anchor], [[], { commit: sha2 }]);
  const byPr = (await run("get_provenance", { repo: APP, pr: 12 })).json;
  assert.deepEqual(byPr.commits, [{ repo: APP, sha: sha2, source: "squash-subject", verified: true }], "unverified commits are hidden");
  assert.deepEqual(byPr.tickets, [{ key: "TRUNK-1", source: "ticket-pattern", verified: true }]);
  assert.deepEqual(byPr.pullRequests, [{ repo: LIB, number: 9, source: "body-ref", verified: true }]);
  const byTicket = (await run("get_provenance", { ticket: "trunk-1" })).json;
  assert.deepEqual(byTicket.pullRequests, [{ repo: APP, number: 12, source: "ticket-pattern", verified: true }]);
  assert.deepEqual(byTicket.tickets, []);
  assert.deepEqual(byTicket.coverageGaps, [`pull requests not ingested for ${NEVER}`]);
});

test("get_provenance: isolation, links into outside repositories dropped, outside repo like a missing one", async () => {
  await seed();
  await store.replaceDiscussion(ids[APP], pr(3), [{ fromKind: "pr", fromRef: "3", toKind: "pr", toRef: "4", toRepo: SECRET, source: "body-ref", verified: true }, ticket(3, "TRUNK-2")]);
  await store.replaceDiscussion(ids[SECRET], pr(4), [ticket(4, "TRUNK-2")]);
  const byPr = (await run("get_provenance", { repo: APP, pr: 3 })).json;
  assert.deepEqual(byPr.pullRequests, []);
  assert.deepEqual((await run("get_provenance", { ticket: "TRUNK-2" })).json.pullRequests.map((p: any) => p.repo), [APP]);
  await assert.rejects(run("get_provenance", { repo: SECRET, pr: 4 }), { message: `Repository "${SECRET}" not found.` });
  await assert.rejects(run("get_provenance", { repo: SECRET, ticket: "TRUNK-2" }), { message: `Repository "${SECRET}" not found.` });
  await assert.rejects(run("get_provenance", { repo: SECRET, path: "a.ts" }), { message: `Repository "${SECRET}" not found.` });
  assert.deepEqual((await run("get_provenance", { repo: NEVER, pr: 1 })).json.coverageGaps, [`pull requests not ingested for ${NEVER}`]);
});

test("get_provenance: more than 50 links per kind are cut and flagged", async () => {
  await seed();
  const links = Array.from({ length: 70 }, (_, i) => commitLink(String(i).padStart(40, "0"), 20));
  await store.replaceDiscussion(ids[APP], pr(20), []);
  await store.replaceCommitLinks(ids[APP], links);
  const { json } = await run("get_provenance", { repo: APP, pr: 20 });
  assert.equal(json.commits.length, 50);
  assert.match(json.truncated.join("\n"), /commits.*50/);
});

test("get_provenance: a path walks bounded local git history and joins links by commit sha", async () => {
  await seed();
  await store.replaceDiscussion(ids[APP], pr(12), []);
  await store.replaceCommitLinks(ids[APP], [commitLink(sha2, 12)]);
  const file = (await run("get_provenance", { repo: APP, path: "a.ts" })).json;
  assert.deepEqual(file.commits.map((c: any) => [c.sha, c.subject]), [[sha2, "tweak the second line (#12)"], [sha1, "initial"]]);
  assert.deepEqual(file.pullRequests, [{ repo: APP, number: 12, source: "squash-subject", verified: true, commit: sha2 }]);
  const span = (await run("get_provenance", { repo: APP, path: "a.ts", startLine: 2, endLine: 2 })).json;
  assert.deepEqual(span.commits.map((c: any) => c.sha), [sha2, sha1]);
  const untouched = (await run("get_provenance", { repo: APP, path: "a.ts", startLine: 4, endLine: 4 })).json;
  assert.deepEqual(untouched.commits.map((c: any) => c.sha), [sha1], "line 4 was never edited after the first commit");
  await assert.rejects(run("get_provenance", { repo: APP, path: "missing.ts" }), /not found in repository/);
  await assert.rejects(run("get_provenance", { repo: APP, path: "../etc/passwd" }), /not found in repository/);
  await assert.rejects(run("get_provenance", { repo: APP, path: "a.ts", startLine: 50, endLine: 60 }), /not found in repository|beyond|lines/);
  assert.deepEqual((await run("get_provenance", { repo: NEVER, path: "a.ts" })).json.coverageGaps, [`pull requests not ingested for ${NEVER}`], "git history is still returned");
});

test("get_provenance: a pathspec-looking path is literal", async () => {
  await seed();
  const r = await run("get_provenance", { repo: APP, path: "*.ts" }).catch((e: Error) => e);
  assert.ok(r instanceof Error ? /not found/.test(r.message) : r.json.commits.length === 0);
});

test("search_discussions: paging stops at the 1000th result and says so instead of repeating the last page", async () => {
  await seedSearch();
  const { json } = await run("search_discussions", { query: "login", page: 51, perPage: 20 });
  assert.deepEqual(json.hits, []);
  assert.match(json.truncated.join("\n"), /paging stops at 1000/);
});

test("history tool schemas convert to closed JSON schemas for MCP", () => {
  for (const n of historyToolNames) {
    const j = toolJsonSchema((tools[n] as unknown as { inputSchema: Parameters<typeof toolJsonSchema>[0] }).inputSchema) as { type: string; additionalProperties: unknown; properties: Record<string, unknown> };
    assert.deepEqual([j.type, j.additionalProperties], ["object", false], n);
    assert.ok(Object.keys(j.properties).length > 0);
  }
});

test("numbers above int32 are rejected with a clear message, in the schema and in #N", async () => {
  await seedSearch();
  await assert.rejects(run("get_pull_request", { repo: APP, number: 1e12 }), /2147483647/);
  await assert.rejects(run("get_provenance", { repo: APP, pr: 1e12 }), /2147483647/);
  await assert.rejects(run("search_discussions", { query: "#99999999999" }), /2147483647/);
  assert.deepEqual((await run("search_discussions", { query: "#2147483647" })).json.hits, []);
});

test("a store error probing one repository does not abort a #N lookup", async () => {
  await seedSearch();
  const real = store.getDiscussion.bind(store);
  store.getDiscussion = async (set, repo, n) => { if (repo === APP) throw new Error("boom"); return real(set, repo, n); };
  assert.deepEqual((await run("search_discussions", { query: "#3" })).json.hits.map((h: any) => h.repo), [LIB]);
});

test("a very long query clips its words before snippets are built", async () => {
  await seedSearch();
  const q = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ") + " login";
  assert.deepEqual((await run("search_discussions", { query: q })).json.hits, []);
});

test("get_pull_request clips url, author, merge commit and comment path/author and says so", async () => {
  await seed();
  await store.replaceDiscussion(ids[APP], pr(9, { url: "https://x/" + "u".repeat(900), authorLogin: "a".repeat(300), mergeCommitSha: "m".repeat(300),
    comments: [comment(1, "c", { path: "p".repeat(900), authorLogin: "b".repeat(300) })] }), []);
  const { json } = await run("get_pull_request", { repo: APP, number: 9 });
  assert.deepEqual([json.url.length, json.author.length, json.mergeCommit.length, json.comments[0].path.length, json.comments[0].author.length], [500, 100, 100, 500, 100]);
  for (const re of [/url/, /author/, /mergeCommit/, /path/]) assert.match(json.truncated.join("\n"), re);
});

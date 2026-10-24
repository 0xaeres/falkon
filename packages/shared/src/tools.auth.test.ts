import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// env is read lazily, so set it before the modules do any work
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-auth-"));
process.env.DATA_DIR = dataDir;
const { createToolRunner } = await import("./tools");
const { setZoektTransport } = await import("./zoekt");
const { someQ } = await import("./ir");
const { scopeFor } = await import("./access");
const { repoGitDir } = await import("./env");
const { setRepoResolver } = await import("./git");
setRepoResolver(async (name) => repoGitDir(name));

const ALLOWED = "github.com/acme/app";
const SECRET = "github.com/acme/secret";
const queries: any[] = [];

function seedRepo(name: string, file: string, body: string) {
  const work = fs.mkdtempSync(path.join(dataDir, "work-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(work, file), body);
  git("add", "."); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  fs.mkdirSync(path.dirname(repoGitDir(name)), { recursive: true });
  execFileSync("git", ["clone", "-q", "--bare", work, repoGitDir(name)]);
}
const loc = (column: number) => ({ byte_offset: column - 1, line_number: 1, column });
const hit = (repo: string) => ({
  file_name: Buffer.from("a.ts"),
  repository: repo,
  branches: ["HEAD"],
  language: "TypeScript",
  chunk_matches: [{ content: Buffer.from("needle\n"), content_start: loc(1), file_name: false, ranges: [{ start: loc(1), end: loc(7) }], symbol_info: [] }],
});

before(() => {
  seedRepo(ALLOWED, "a.ts", "needle\n");
  seedRepo(SECRET, "s.ts", "needle secret\n");
  // A zoekt that ignores the injected scope and returns both repos, to prove post-filtering.
  const respond = (req: { query: unknown }) => {
    queries.push(req.query);
    return { files: [hit(ALLOWED), hit(SECRET)], stats: { match_count: 2, file_count: 2 } };
  };
  setZoektTransport({
    search: async (req) => respond(req),
    async *stream(req) { yield respond(req); },
  });
});
after(() => { setZoektTransport(undefined); fs.rmSync(dataDir, { recursive: true, force: true }); });

const rows = [ALLOWED, SECRET].map((name) => ({
  name, displayName: null, codeHostType: "genericGitHost", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false,
  pushedAt: null, indexedAt: null, indexedRevisions: ["refs/heads/main"], path: repoGitDir(name),
}));
const run = createToolRunner({ getRepo: async (n) => rows.find((r) => r.name === n), listRepos: async () => rows });
const scope = scopeFor([ALLOWED]);

test("repo-bound tools refuse a repo outside the scope with the same error as a missing repo", async () => {
  const calls: [string, Record<string, unknown>][] = [
    ["read_file", { repo: SECRET, path: "s.ts" }],
    ["list_tree", { repo: SECRET }],
    ["list_commits", { repo: SECRET }],
    ["list_branches", { repo: SECRET }],
    ["get_diff", { repo: SECRET, base: "HEAD", head: "HEAD" }],
    ["find_symbol_definitions", { repo: SECRET, symbol: "x" }],
    ["find_symbol_references", { repo: SECRET, symbol: "x" }],
    ["grep", { pattern: "needle", repo: SECRET }],
    ["glob", { pattern: "*.ts", repo: SECRET }],
  ];
  // list_branches reports every failure as "Failed to list branches.": still no difference between hidden and missing.
  for (const [name, args] of calls) {
    await assert.rejects(run(name, args, scope), name === "list_branches" ? /^Error: Failed to list branches\.$/ : new RegExp(`Repository "${SECRET}" not found`), name);
  }
  await assert.rejects(run("list_branches", { repo: "github.com/acme/none" }, scopeFor(["*"])), /Failed to list branches\./);
  await assert.rejects(run("read_file", { repo: "github.com/acme/none", path: "x" }, scopeFor(["*"])), /Repository "github.com\/acme\/none" not found/);
});

test("an allowed repo still reads", async () => {
  assert.match(await run("read_file", { repo: ALLOWED, path: "a.ts" }, scope), /needle/);
});

const andChildren = (q: any): any[] => q.and.children;
const hasRepoScope = (q: any, filter: string) => andChildren(q).some((c) => c.repo?.regexp === filter);

test("grep injects the scope filter and drops out-of-scope hits and counts a lying zoekt returns", async () => {
  queries.length = 0;
  const out = await run("grep", { pattern: "needle" }, scope);
  assert.ok(hasRepoScope(queries[0], scope.repoFilter!), JSON.stringify(queries[0]));
  assert.match(out, new RegExp(ALLOWED));
  assert.doesNotMatch(out, /secret/);
  assert.doesNotMatch(out, /2 total matches/);
});

test("hostile patterns stay in their own leaf and cannot widen the query", async () => {
  queries.length = 0;
  await run("grep", { pattern: `x) or (repo:secret`, path: `a" or repo:.*` }, scope);
  const q = queries[0];
  assert.ok(hasRepoScope(q, scope.repoFilter!));
  assert.ok(!someQ(q, (n) => "or" in n), JSON.stringify(q));
  // the scope node is a direct child of the top-level AND, not nested under anything user text controls
  assert.equal(andChildren(q).filter((c) => c.repo).length, 1);
});

test("glob and symbol searches are scoped and filtered", async () => {
  for (const [name, args] of [["glob", { pattern: "*.ts" }], ["find_symbol_definitions", { symbol: "x", repo: ALLOWED }], ["find_symbol_references", { symbol: "x", repo: ALLOWED }]] as const) {
    queries.length = 0;
    const out = await run(name, args, scope);
    assert.ok(hasRepoScope(queries[0], scope.repoFilter!), name);
    assert.doesNotMatch(out, /secret/, name);
  }
});

test("list_repos shows only scoped repos and pages over the visible set", async () => {
  const out = JSON.parse(await run("list_repos", { perPage: 1, page: 1 }, scope)) as { repos: { name: string }[] };
  assert.deepEqual(out.repos.map((r) => r.name), [ALLOWED]);
  const page2 = JSON.parse(await run("list_repos", { perPage: 1, page: 2 }, scope)) as { repos: unknown[] };
  assert.equal(page2.repos.length, 0);
  const all = JSON.parse(await run("list_repos", {}, scopeFor(["*"]))) as { repos: unknown[] };
  assert.equal(all.repos.length, 2);
});

// S60: a bare name that is the last segment of exactly one in-scope repository gets a hint.
const hintRows = ["github.com/openmrs/esm-core", "github.com/acme/dup", "gitlab.com/other/dup", "github.com/acme/Mixed", "github.com/acme/hidden"].map((name) => ({ ...rows[0]!, name }));
const hintRun = createToolRunner({ getRepo: async (n) => hintRows.find((r) => r.name === n), listRepos: async () => hintRows });
const notFoundFor = (repo: string, s = scopeFor(["*"])) => hintRun("read_file", { repo, path: "x" }, s).then(() => assert.fail("resolved"), (e: Error) => e.message);

test("a bare name matching one in-scope repository suggests the full name", async () => {
  assert.equal(await notFoundFor("esm-core"), 'Repository "esm-core" not found. Did you mean "github.com/openmrs/esm-core"?');
});

test("no hint when the name is ambiguous, unknown, differently cased, empty, path-like or already full", async () => {
  for (const n of ["dup", "nothing", "mixed", "", "a/b/c", "github.com/openmrs/nope"]) {
    assert.equal(await notFoundFor(n), `Repository "${n}" not found.`, n);
  }
});

test("a repository outside the caller's scope is never suggested", async () => {
  const s = scopeFor(["github.com/acme/dup"]);
  assert.equal(await notFoundFor("hidden", s), 'Repository "hidden" not found.');
  assert.equal(await notFoundFor("esm-core", s), 'Repository "esm-core" not found.');
  // out-of-scope twin does not make an in-scope name ambiguous
  assert.equal(await notFoundFor("dup", s), 'Repository "dup" not found. Did you mean "github.com/acme/dup"?');
});

test("a failing listRepos leaves the plain not-found text", async () => {
  const boom = createToolRunner({ getRepo: async () => undefined, listRepos: async () => { throw new Error("db down"); } });
  await assert.rejects(boom("read_file", { repo: "esm-core", path: "x" }, scopeFor(["*"])), { message: 'Repository "esm-core" not found.' });
});

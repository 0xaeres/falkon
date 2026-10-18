import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// env is read lazily, so set it before the modules do any work
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbc-auth-"));
process.env.DATA_DIR = dataDir;
const { createToolRunner } = await import("./tools");
const { scopeFor } = await import("./access");
const { repoGitDir } = await import("./env");

const ALLOWED = "github.com/acme/app";
const SECRET = "github.com/acme/secret";
const queries: string[] = [];
let zoekt: http.Server;

function seedRepo(name: string, file: string, body: string) {
  const work = fs.mkdtempSync(path.join(dataDir, "work-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(work, file), body);
  git("add", "."); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  fs.mkdirSync(path.dirname(repoGitDir(name)), { recursive: true });
  execFileSync("git", ["clone", "-q", "--bare", work, repoGitDir(name)]);
}
const b64 = (s: string) => Buffer.from(s + "\n").toString("base64");
const hit = (repo: string) => ({ FileName: "a.ts", Repository: repo, LineMatches: [{ Line: b64("needle"), LineNumber: 1, FileName: false, LineFragments: [] }] });

before(async () => {
  seedRepo(ALLOWED, "a.ts", "needle\n");
  seedRepo(SECRET, "s.ts", "needle secret\n");
  // A zoekt that ignores the injected filter and returns both repos, to prove post-filtering.
  zoekt = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
      queries.push(JSON.parse(raw).Q);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ Result: { Files: [hit(ALLOWED), hit(SECRET)], MatchCount: 2, FileCount: 2 } }));
    });
  });
  await new Promise<void>((r) => zoekt.listen(0, "127.0.0.1", r));
  process.env.ZOEKT_URL = `http://127.0.0.1:${(zoekt.address() as { port: number }).port}`;
});
after(() => { zoekt.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const rows = [ALLOWED, SECRET].map((name) => ({ name, defaultBranch: "main", status: "INDEXED", pushedAt: null }));
const run = createToolRunner({ listRepos: async () => rows });
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
  for (const [name, args] of calls) await assert.rejects(run(name, args, scope), new RegExp(`repo not found: ${SECRET}`), name);
  await assert.rejects(run("read_file", { repo: "github.com/acme/none", path: "x" }, scopeFor(["*"])), /repo not found: github.com\/acme\/none/);
});

test("an allowed repo still reads", async () => {
  assert.match(await run("read_file", { repo: ALLOWED, path: "a.ts" }, scope), /needle/);
});

test("grep injects the scope filter and drops out-of-scope hits and counts a lying zoekt returns", async () => {
  queries.length = 0;
  const out = await run("grep", { pattern: "needle" }, scope);
  assert.match(queries[0]!, /repo:\^\(\?:github\\x2ecom\/acme\/app\)\$/);
  assert.match(out, new RegExp(ALLOWED));
  assert.doesNotMatch(out, /secret/);
  assert.doesNotMatch(out, /2 total matches/);
});

test("hostile patterns cannot add an alternative that widens the query", async () => {
  queries.length = 0;
  await run("grep", { pattern: `x) or (repo:secret`, path: `a" or repo:.*` }, scope);
  const q = queries[0]!;
  assert.ok(q.includes("repo:^(?:github\\x2ecom/acme/app)$"));
  assert.ok(!/\s(or|OR)\s/.test(q), q);
});

test("glob and symbol searches are scoped and filtered", async () => {
  for (const [name, args] of [["glob", { pattern: "*.ts" }], ["find_symbol_definitions", { symbol: "x", repo: ALLOWED }], ["find_symbol_references", { symbol: "x", repo: ALLOWED }]] as const) {
    queries.length = 0;
    const out = await run(name, args, scope);
    assert.match(queries[0]!, /repo:/, name);
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

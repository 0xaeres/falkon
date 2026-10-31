import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { before, after } from "node:test";
import { scopeFor } from "./access";
import { fanOut, gitToolDefinitions } from "./gitTools";
import { runGit } from "./gitRun";
import type { ToolContext, ToolRepo } from "./tools";

const cwd = os.tmpdir();

test("runGit: returns what git printed and no limit flag", async () => {
  const r = await runGit(cwd, ["--version"], { maxBytes: 1000, timeoutMs: 5000 });
  assert.match(r.stdout, /^git version/);
  assert.equal(r.limit, undefined);
  assert.equal(r.code, 0);
});

test("runGit: a failing git hands back its error text", async () => {
  const r = await runGit(cwd, ["log", "--no-such-flag"], { maxBytes: 1000, timeoutMs: 5000 });
  assert.match(r.stderr, /^fatal: /);
  assert.equal((await runGit(cwd, ["--version"], { maxBytes: 1000, timeoutMs: 5000 })).stderr, "");
});

test("runGit: kills git at the byte limit and says so", async () => {
  const r = await runGit(cwd, ["-c", "alias.big=!yes | head -c 10000000", "big"], { maxBytes: 1000, timeoutMs: 5000 });
  assert.equal(r.limit, "bytes");
  assert.equal(r.stdout.length, 1000);
});

test("runGit: kills git at the time limit and returns at once, not when the child tree ends", async () => {
  const t0 = Date.now();
  const r = await runGit(cwd, ["-c", "alias.slow=!sleep 5", "slow"], { maxBytes: 1000, timeoutMs: 200 });
  assert.equal(r.limit, "time");
  assert.ok(Date.now() - t0 < 2000);
});

test("runGit: a failing git reports its exit code, not a throw", async () => {
  const r = await runGit(cwd, ["log", "--no-such-flag"], { maxBytes: 1000, timeoutMs: 5000 });
  assert.notEqual(r.code, 0);
  assert.equal(r.limit, undefined);
});

test("fanOut: concurrency 4, at most 50 items (the rest counted), results in input order", async () => {
  let live = 0, peak = 0;
  const items = Array.from({ length: 60 }, (_, i) => i);
  const out = await fanOut(items, async (i) => { peak = Math.max(peak, ++live); await new Promise((r) => setTimeout(r, 5)); live--; return i * 2; });
  assert.equal(peak, 4);
  assert.equal(out.done.length, 50);
  assert.deepEqual(out.done.slice(0, 3), [[0, 0], [1, 2], [2, 4]]);
  assert.equal(out.overCap, 10);
  assert.deepEqual(out.late, []);
});

test("fanOut: past the total deadline items are not started (listed as late); a started one gets only the time left", async () => {
  const seen: number[] = [];
  const out = await fanOut([1, 2, 3, 4], async (_i, ms) => { seen.push(ms); await new Promise((r) => setTimeout(r, 60)); }, { concurrency: 1, repoMs: 1000, totalMs: 100, repos: 50 });
  assert.deepEqual(out.late, [3, 4]);
  assert.ok(seen[0]! <= 100 && seen[1]! < seen[0]!);
});

// ---- search_commits against a real temporary repository ----

const A = "fixtures.test/atlas", B = "fixtures.test/beta", SECRET = "fixtures.test/secret";
let dir: string, other: string;
const sh: Record<string, string> = {};
const mk = (d: string, ...a: string[]) => {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  return execFileSync("git", a, { cwd: d, env, stdio: "pipe" }).toString().trim();
};
const commit = (d: string, name: string, date: string, msg: string, file: string, body: string) => {
  fs.writeFileSync(path.join(d, file), body);
  mk(d, "add", ".");
  const env = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@x.test`, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name.toLowerCase()}@x.test`, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-F", "-"], { cwd: d, input: msg, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", ...env }, stdio: ["pipe", "pipe", "pipe"] });
  return mk(d, "rev-parse", "HEAD");
};
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gitt-"));
  other = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gitt-"));
  mk(dir, "init", "-q", "-b", "main");
  sh.c1 = commit(dir, "Alice", "2024-01-10T12:00:00Z", "initial import (#1)", "a.ts", "alpha\n");
  sh.c2 = commit(dir, "Bob", "2024-02-10T12:00:00Z", "TRUNK-5: add the needle\n\nbody text mentions a.b literally", "a.ts", "alpha\nneedle\n");
  sh.c3 = commit(dir, "Alice", "2024-03-10T12:00:00Z", "Merge pull request #9 from x/y", "b.ts", "beta\n");
  mk(dir, "checkout", "-q", "-b", "feature/x");
  sh.c4 = commit(dir, "Carol", "2024-04-10T12:00:00Z", "o3-77 feature work", "c.ts", "gamma\n");
  mk(dir, "checkout", "-q", "main");
  mk(other, "init", "-q", "-b", "main");
  sh.o1 = commit(other, "Dave", "2024-05-10T12:00:00Z", "beta repo change", "z.ts", "zeta needle\n");
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); });

const row = (name: string, p: string): ToolRepo => ({ name, displayName: null, codeHostType: "github", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: p });
const ctx = (...patterns: string[]): ToolContext => {
  const repos = [row(A, dir), row(B, other), row(SECRET, other)];
  return { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, ticketKeys: ["TRUNK", "O3"] }, scope: scopeFor(patterns.length ? patterns : [A, B]) };
};
const search = async (args: Record<string, unknown>, c = ctx()) => {
  const d = gitToolDefinitions.search_commits;
  const { output } = await d.execute(d.inputSchema.parse(args), c);
  return { text: output, json: JSON.parse(output) as any };
};
const hashes = (r: { json: any }) => r.json.commits.map((c: any) => c.hash);

test("search_commits: each filter alone returns exactly the expected commits, newest first", async () => {
  assert.deepEqual(hashes(await search({ repos: [A], revisions: ["main"] })), [sh.c3, sh.c2, sh.c1]);
  assert.deepEqual(hashes(await search({ repos: [A], authors: ["alice"] })), [sh.c3, sh.c1]);
  assert.deepEqual(hashes(await search({ repos: [A], messageTerms: ["NEEDLE", "initial"] })), [sh.c2, sh.c1]);
  assert.deepEqual(hashes(await search({ repos: [A], files: ["b.ts", "c.ts"] })), [sh.c3]);
  assert.deepEqual(hashes(await search({ repos: [A], after: "2024-02-01", before: "2024-02-28" })), [sh.c2]);
  assert.deepEqual(hashes(await search({ repos: [A], contentTerms: ["needle"] })), [sh.c2]);
  assert.deepEqual(hashes(await search({ repos: [A], count: 2 })), [sh.c3, sh.c2]);
});

test("search_commits: filters combine (AND across kinds, OR inside one)", async () => {
  assert.deepEqual(hashes(await search({ repos: [A], authors: ["alice"], messageTerms: ["merge"] })), [sh.c3]);
  assert.deepEqual(hashes(await search({ repos: [A], authors: ["bob", "alice"], after: "2024-02-01" })), [sh.c3, sh.c2]);
  assert.deepEqual(hashes(await search({ repos: [A], contentTerms: ["needle"], files: ["a.ts"], authors: ["bob"] })), [sh.c2]);
});

test("search_commits: several repositories merge by date; revisions with a glob reach other branches", async () => {
  const r = await search({ repos: [A, B], messageTerms: ["feature", "beta repo"], revisions: ["refs/heads/*"] });
  assert.deepEqual(r.json.commits.map((c: any) => [c.repo, c.hash]), [[B, sh.o1], [A, sh.c4]]);
  assert.deepEqual(hashes(await search({ repos: [A], revisions: ["main", "refs/heads/*"], messageTerms: ["initial"] })), [sh.c1], "reachable from two refs: once");
});

// ---- adversarial cases ----

const refuses = (args: Record<string, unknown>, re: RegExp) => assert.rejects(() => search(args), re);

test("search_commits: option look-alikes are plain text or refused; nothing is written", async () => {
  const out = path.join(os.tmpdir(), `falkon-x-${process.pid}`);
  for (const bad of [`--output=${out}`, "--upload-pack=touch /tmp/pwned", "-p"]) {
    assert.deepEqual(hashes(await search({ repos: [A], authors: [bad] })), [], bad);
    assert.deepEqual(hashes(await search({ repos: [A], messageTerms: [bad] })), [], bad);
    assert.deepEqual(hashes(await search({ repos: [A], files: [bad] })), [], bad);
    await refuses({ repos: [A], revisions: [bad] }, /not accepted/);
  }
  assert.equal(fs.existsSync(out), false);
});

test("search_commits: ref globs `--all`, `..`, empty and option-like are refused with a reason", async () => {
  for (const r of ["--all", "main..feature/x", "refs/heads/../x", "", "-*", "a b"]) await refuses({ repos: [A], revisions: [r] }, /not accepted/);
});

test("search_commits: content terms need a date, files or repository filter, and git is not run", async () => {
  await refuses({ contentTerms: ["needle"] }, /narrowing filter/);
  assert.deepEqual(hashes(await search({ contentTerms: ["needle"], files: ["a.ts"] })), [sh.c2]);
  assert.deepEqual(hashes(await search({ contentTerms: ["needle"], repos: [A] })), [sh.c2]);
});

test("search_commits: regular-expression terms match literally", async () => {
  for (const x of [".*", "(", "[", "\\", "a|b", "^", "$"]) {
    assert.deepEqual(hashes(await search({ repos: [A], messageTerms: [x] })), x === "(" ? [sh.c1] : [], `message ${x}`); // c1's subject really contains "("
    assert.deepEqual(hashes(await search({ repos: [A], authors: [x] })), [], `author ${x}`);
    assert.deepEqual(hashes(await search({ repos: [A], contentTerms: [x], files: ["a.ts"] })), [], `content ${x}`);
  }
  assert.deepEqual(hashes(await search({ repos: [A], messageTerms: ["a.b"] })), [sh.c2]);
  assert.deepEqual(hashes(await search({ repos: [A], messageTerms: ["a.c"] })), []);
});

test("search_commits: a repository outside the scope reads exactly like a missing one", async () => {
  const hidden = await search({ repos: [SECRET] }, ctx(A, B));
  const missing = await search({ repos: ["fixtures.test/nope"] }, ctx(A, B));
  assert.deepEqual(hidden.json.commits, []);
  assert.equal(hidden.text.replaceAll(SECRET, "<r>"), missing.text.replaceAll("fixtures.test/nope", "<r>"));
  assert.deepEqual(hidden.json.coverageGaps, [`repository "${SECRET}" not found`]);
  const all = await search({}, ctx(A));
  assert.ok(all.json.commits.every((c: any) => c.repo === A));
});

test("search_commits: more than 50 repositories gives a gap naming how many were skipped; the others answer", async () => {
  const repos = Array.from({ length: 57 }, (_, i) => row(`fixtures.test/r${i}`, i % 2 ? dir : other));
  const c: ToolContext = { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos }, scope: scopeFor(["*"]) };
  const r = await search({ count: 100 }, c);
  assert.ok(r.json.coverageGaps.includes("7 repositories skipped: at most 50 are read per call"));
  assert.ok(r.json.commits.length > 0);
});

test("search_commits: a repository where git fails is a gap and the others still answer", async () => {
  const c = ctx();
  const broken = row("fixtures.test/broken", path.join(os.tmpdir(), "falkon-no-such-dir"));
  const base = c.deps.listRepos;
  c.deps.listRepos = async (o) => [...(await base(o)), broken];
  c.deps.getRepo = async (n) => (await c.deps.listRepos({ sort: "name", direction: "asc" })).find((r) => r.name === n);
  const r = await search({ repos: [A, "fixtures.test/broken"], messageTerms: ["initial"] }, { ...c, scope: scopeFor(["*"]) });
  assert.deepEqual(hashes(r), [sh.c1]);
  assert.equal(r.json.coverageGaps.length, 1);
  assert.match(r.json.coverageGaps[0], /^fixtures\.test\/broken: /);
});

test("search_commits: count and dates are validated", async () => {
  for (const count of [0, 101, -1, 1.5]) await assert.rejects(async () => search({ repos: [A], count }), `count ${count}`);
  await refuses({ repos: [A], after: "2024-05-01", before: "2024-01-01" }, /later than/);
  await refuses({ repos: [A], after: "not a date" }, /not a date/);
  await refuses({ repos: [A], before: "31st of never" }, /not a date/);
  assert.deepEqual(hashes(await search({ repos: [A], before: "2024-02-10" })), [sh.c2, sh.c1], "a date-only before includes that day");
});

test("search_commits: a ref glob matching nothing, or a missing revision, is a gap, not a crash", async () => {
  assert.deepEqual(hashes(await search({ repos: [A], revisions: ["refs/tags/*"] })), []);
  const r = await search({ repos: [A], revisions: ["no-such-branch"] });
  assert.deepEqual(r.json.commits, []);
  assert.match(r.json.coverageGaps[0], /could not read/);
});

test("search_commits: ticket keys (any case) and pull request numbers come from the message, marked unverified", async () => {
  const r = await search({ repos: [A], revisions: ["main", "refs/heads/*"] });
  const by = Object.fromEntries(r.json.commits.map((c: any) => [c.hash, c]));
  assert.deepEqual([by[sh.c1].pullRequests, by[sh.c1].ticketKeys], [[1], []]);
  assert.deepEqual([by[sh.c2].pullRequests, by[sh.c2].ticketKeys], [[], ["TRUNK-5"]]);
  assert.deepEqual(by[sh.c3].pullRequests, [9]);
  assert.deepEqual(by[sh.c4].ticketKeys, ["O3-77"], "lower-case key");
  assert.match(by[sh.c4].linksSource, /unverified/);
});

test("search_commits: empty result echoes the filters; non-UTF-8 author and a 1 MB message are handled", async () => {
  const r = await search({ repos: [A], authors: ["nobody"], after: "2024-01-01" });
  assert.deepEqual(r.json.commits, []);
  assert.deepEqual([r.json.filters.authors, r.json.filters.after], [["nobody"], "2024-01-01"]);

  const tree = mk(dir, "rev-parse", "main^{tree}");
  const raw = Buffer.concat([Buffer.from(`tree ${tree}\nauthor Ren\xe9 <r@x.test> 1714000000 +0000\ncommitter F <f@x.test> 1714000000 +0000\n\nlatin1 author\n`, "latin1")]);
  const sha = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: dir, input: raw }).toString().trim();
  mk(dir, "update-ref", "refs/heads/latin", sha);
  const l = await search({ repos: [A], revisions: ["refs/heads/latin"], messageTerms: ["latin1"] });
  assert.equal(l.json.commits[0].hash, sha);
  assert.ok(typeof l.json.commits[0].author === "string");

  fs.writeFileSync(path.join(dir, "big.txt"), "x");
  const bigMsg = "huge subject\n\n" + "y".repeat(1_000_000);
  const big = commit(dir, "Eve", "2024-06-10T12:00:00Z", bigMsg, "big.txt", "xx");
  const b = await search({ repos: [A], authors: ["eve"] });
  assert.equal(b.json.commits[0].hash, big);
  assert.match(b.json.commits[0].messageCut, /cut to 2000/);
  assert.ok(b.json.commits[0].message.length <= 2000);
  mk(dir, "reset", "-q", "--hard", sh.c3);
});

test("search_commits: the answer never exceeds the byte cap and says it was cut", async () => {
  const hist = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gitt-"));
  try {
    mk(hist, "init", "-q", "-b", "main");
    for (let i = 0; i < 40; i++) commit(hist, "Zed", `2024-07-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`, `change ${i}\n\n${"w".repeat(1500)}`, "f.txt", String(i));
    const c: ToolContext = { deps: { getRepo: async () => row(A, hist), listRepos: async () => [row(A, hist)] }, scope: scopeFor(["*"]) };
    const r = await search({ repos: [A], count: 40 }, c);
    assert.ok(Buffer.byteLength(r.text) <= 24_000);
    assert.ok(r.json.commits.length < 40 && r.json.commits.length > 0);
    assert.match(r.json.truncated[0], /byte cap/);
  } finally { fs.rmSync(hist, { recursive: true, force: true }); }
});

// ---- fix round ----

test("search_commits: with `repos` omitted and 120 visible repositories, at most 50 are looked up and the answer holds the byte cap", async () => {
  const repos = Array.from({ length: 120 }, (_, i) => row(`fixtures.test/${"long-".repeat(40)}${i}`, i % 2 ? dir : other));
  let lookups = 0;
  const c: ToolContext = { deps: { getRepo: async (n) => (lookups++, repos.find((r) => r.name === n)), listRepos: async () => repos }, scope: scopeFor(["*"]) };
  const r = await search({ count: 100 }, c);
  assert.ok(lookups <= 50, `getRepo called ${lookups} times`);
  assert.ok(Buffer.byteLength(r.text) <= 24_000);
  assert.ok(r.json.coverageGaps.includes("70 repositories skipped: at most 50 are read per call"));
  const echoed = r.json.filters.repos; // the names, or only their count when the names would break the byte cap
  assert.ok((Array.isArray(echoed) ? echoed.length : echoed) <= 50);
});

test("search_commits: the byte cap also holds when the filters and the gaps are what is large", async () => {
  const names = Array.from({ length: 200 }, (_, i) => `fixtures.test/${"x".repeat(250)}${i}`);
  const r = await search({ repos: names, contentTerms: ["t".repeat(200)] });
  assert.ok(Buffer.byteLength(r.text) <= 24_000, `${Buffer.byteLength(r.text)} bytes`);
  assert.match(JSON.stringify(r.json.truncated), /byte cap/);
});

test("search_commits: a repository that hits the time limit is a gap and another repository still answers", async () => {
  const slow = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gitt-"));
  try {
    mk(slow, "init", "-q", "-b", "main");
    commit(slow, "Sam", "2024-08-10T12:00:00Z", "slow needle", "a.ts", "needle\n");
    // a text conversion that sleeps makes `git log -G` slow in this repository only
    mk(slow, "config", "diff.slow.textconv", "sleep 3; cat");
    fs.writeFileSync(path.join(slow, ".git", "info", "attributes"), "*.ts diff=slow\n");
    const repos = [row(A, dir), row("fixtures.test/slow", slow)];
    const c: ToolContext = { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, gitLimits: { repoMs: 1000 } }, scope: scopeFor(["*"]) };
    const r = await search({ repos: [A, "fixtures.test/slow"], contentTerms: ["needle"], files: ["a.ts"] }, c);
    assert.deepEqual(hashes(r), [sh.c2]);
    assert.deepEqual(r.json.coverageGaps, ["fixtures.test/slow: timed out after 1 seconds; its commits may be missing"]);
  } finally { fs.rmSync(slow, { recursive: true, force: true }); }
});

test("search_commits: a repository that hits the byte limit is a gap, its cut last record is dropped, its complete ones stay", async () => {
  const fat = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gitt-"));
  try {
    mk(fat, "init", "-q", "-b", "main");
    const oldest = commit(fat, "Fay", "2024-09-01T12:00:00Z", "oldest\n\n" + "z".repeat(20_000), "f.txt", "1");
    const newer = commit(fat, "Fay", "2024-09-02T12:00:00Z", "newer small", "f.txt", "2");
    const repos = [row(A, dir), row("fixtures.test/fat", fat)];
    const c: ToolContext = { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, gitLimits: { repoBytes: 3000 } }, scope: scopeFor(["*"]) };
    const r = await search({ repos: [A, "fixtures.test/fat"], revisions: ["main"] }, c);
    const got = r.json.commits.map((x: any) => x.hash);
    assert.ok(got.includes(newer) && !got.includes(oldest), "complete record kept, cut record dropped");
    assert.ok(got.includes(sh.c3), "the other repository still answers");
    assert.deepEqual(r.json.coverageGaps, ["fixtures.test/fat: output cut at 3000 bytes; its commits may be missing"]);
  } finally { fs.rmSync(fat, { recursive: true, force: true }); }
});

test("search_commits: pathspec magic in `files` is literal (matches nothing), content terms ignore case", async () => {
  for (const f of [":(top)", ":(glob)*", ":/", ":(top)a.ts"]) assert.deepEqual(hashes(await search({ repos: [A], files: [f] })), [], f);
  assert.deepEqual(hashes(await search({ repos: [A], contentTerms: ["NEEDLE"], files: ["a.ts"] })), [sh.c2]);
});

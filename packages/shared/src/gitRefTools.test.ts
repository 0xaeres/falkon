import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scopeFor } from "./access";
import { gitToolDefinitions, gitToolNames } from "./gitTools";
import type { ToolContext, ToolRepo } from "./tools";

// list_refs and check_ancestry against real temporary repositories (cycle 19, S78).
const R = "fixtures.test/refs", OTHER = "fixtures.test/other", SECRET = "fixtures.test/hidden";
let dir: string, other: string;
const sh: Record<string, string> = {};
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@x.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@x.test" };
const mk = (d: string, ...a: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...a], { cwd: d, env: ENV, stdio: "pipe" }).toString().trim();
let tick = 0;
const commit = (d: string, msg: string) => {
  const date = new Date(Date.UTC(2024, 0, 1, 0, 0, ++tick)).toISOString();
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", msg], { cwd: d, env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: "pipe" });
  return mk(d, "rev-parse", "HEAD");
};
// Two commits whose ids start with the same four characters, so that prefix is ambiguous.
function ambiguousPair(d: string) {
  mk(d, "hash-object", "-t", "tree", "-w", "--stdin");
  const body = (i: number) => `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nauthor a <a@x> 1 +0000\ncommitter a <a@x> 1 +0000\n\nmsg ${i}\n`;
  const seen = new Map<string, number>();
  for (let i = 0; ; i++) {
    const b = body(i), s = crypto.createHash("sha1").update(`commit ${Buffer.byteLength(b)}\0`).update(b).digest("hex"), p = s.slice(0, 4);
    if (seen.has(p)) {
      for (const k of [i, seen.get(p)!]) execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: d, env: ENV, input: body(k), stdio: "pipe" });
      return p;
    }
    seen.set(p, i);
  }
}
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grt-"));
  other = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grt-"));
  mk(dir, "init", "-q", "-b", "main");
  sh.c1 = commit(dir, "one");
  mk(dir, "tag", "v1");
  sh.c2 = commit(dir, "two");
  mk(dir, "tag", "-a", "-m", "release two", "v2");
  mk(dir, "-c", "advice.nestedTag=false", "tag", "-a", "-m", "alias of a tag", "v2-alias", "v2");
  mk(dir, "checkout", "-q", "-b", "feat");
  sh.c4 = commit(dir, "feature work");
  mk(dir, "checkout", "-q", "-b", "tmp");
  sh.c5 = commit(dir, "only a tag reaches this");
  mk(dir, "tag", "v-only");
  mk(dir, "checkout", "-q", "main");
  mk(dir, "branch", "-q", "-D", "tmp");
  sh.c3 = commit(dir, "three");
  mk(dir, "checkout", "-q", "--orphan", "unrelated");
  sh.r1 = commit(dir, "second root");
  mk(dir, "checkout", "-q", "main");
  sh.dangling = mk(dir, "commit-tree", "-m", "nobody points here", "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  sh.prefix = ambiguousPair(dir);
  mk(other, "init", "-q", "-b", "main");
  sh.o1 = commit(other, "other repo");
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); });

const row = (name: string, p: string): ToolRepo => ({ name, displayName: null, codeHostType: "github", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: p });
const ctx = (gitLimits?: { repoMs?: number; repoBytes?: number }): ToolContext => {
  const repos = [row(R, dir), row(OTHER, other), row(SECRET, other)];
  return { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, gitLimits }, scope: scopeFor([R, OTHER]) };
};
const call = async (tool: "list_refs" | "check_ancestry", args: Record<string, unknown>, c = ctx()) => {
  const d = gitToolDefinitions[tool];
  const { output } = await d.execute(d.inputSchema.parse(args) as never, c);
  return { text: output, json: JSON.parse(output) as any };
};
const refs = (args: Record<string, unknown> = {}, c = ctx()) => call("list_refs", { repos: [R], ...args }, c);
const names = (r: { json: any }) => r.json.refs.map((x: any) => x.name).sort();
const ancestry = (args: Record<string, unknown>, c = ctx()) => call("check_ancestry", { repo: R, ...args }, c);

test("the two tools register after the earlier git tools", () => {
  assert.deepEqual(gitToolNames.slice(-3), ["list_refs", "check_ancestry", "get_range_history"]);
});

// ---- list_refs ----

test("list_refs: heads, tags, or both, newest first, with the commit each points at", async () => {
  assert.deepEqual(names(await refs({ kind: "heads" })), ["feat", "main", "unrelated"]);
  assert.deepEqual(names(await refs({ kind: "tags" })), ["v-only", "v1", "v2", "v2-alias"]);
  const both = await refs();
  assert.deepEqual(names(both), ["feat", "main", "unrelated", "v-only", "v1", "v2", "v2-alias"]);
  const byName = Object.fromEntries(both.json.refs.map((x: any) => [x.name, x]));
  assert.deepEqual([byName.main.kind, byName.main.target, byName.v1.kind, byName.v1.target], ["branch", sh.c3, "tag", sh.c1]);
  assert.equal(byName.v2.target, sh.c2, "an annotated tag shows the commit, not the tag object");
  assert.equal(byName["v2-alias"].target, sh.c2, "a tag that points at a tag shows the commit it finally reaches");
  assert.equal(byName["v-only"].target, sh.c5, "a tag on a commit no branch reaches");
  const dates = both.json.refs.map((x: any) => x.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("list_refs: which refs contain a commit: in one branch, in several, in none", async () => {
  assert.deepEqual(names(await refs({ contains: sh.c3 })), ["main"]);
  assert.deepEqual(names(await refs({ contains: sh.c2 })), ["feat", "main", "v-only", "v2", "v2-alias"], "c2 reaches main, feat, and the tags above it; not unrelated, not v1");
  assert.deepEqual(names(await refs({ contains: sh.c2, kind: "tags" })), ["v-only", "v2", "v2-alias"]);
  assert.deepEqual(names(await refs({ contains: sh.c2, kind: "heads" })), ["feat", "main"]);
  assert.deepEqual(names(await refs({ contains: sh.r1 })), ["unrelated"]);
  assert.deepEqual(names(await refs({ contains: "v1" })), ["feat", "main", "v-only", "v1", "v2", "v2-alias"], "a tag name works as the commit");
  assert.deepEqual(names(await refs({ contains: sh.c1.slice(0, 10) })), ["feat", "main", "v-only", "v1", "v2", "v2-alias"], "a prefix works");
  const none = await refs({ contains: sh.dangling });
  assert.deepEqual([none.json.refs, none.json.coverageGaps], [[], []]);
  assert.match(none.json.summary, /No refs/);
});

test("list_refs: an unknown, ambiguous or too-short commit is a gap with the reason, other repositories still answer", async () => {
  const gone = await call("list_refs", { repos: [R, OTHER], contains: sh.o1 });
  assert.deepEqual(names(gone), ["main"]);
  assert.deepEqual(gone.json.coverageGaps, [`${R}: revision "${sh.o1}" could not be resolved: not found in this repository`]);
  const amb = await refs({ contains: sh.prefix });
  assert.deepEqual(amb.json.refs, []);
  assert.match(amb.json.coverageGaps[0], /ambiguous/);
  const short = await refs({ contains: "ab" });
  assert.deepEqual(short.json.refs, []);
  assert.match(short.json.coverageGaps[0], /not found/);
});

test("list_refs: an option look-alike or bad revision is refused and nothing is written", async () => {
  const out = path.join(dir, "pwned");
  for (const bad of ["--all", "-x", `--output=${out}`, "a..b", "", "a b", "x:y", "x{y}", "v1\n--all", "refs/heads/*"]) await assert.rejects(() => refs({ contains: bad }), /not accepted/, JSON.stringify(bad));
  assert.equal(fs.existsSync(out), false);
  for (const args of [{ kind: "all" }, { count: 0 }, { count: 501 }, { unknown: 1 }]) await assert.rejects(() => refs(args), JSON.stringify(args));
});

test("list_refs: a repository the scope excludes reads like a missing one; more than 50 repositories gives a gap", async () => {
  const hidden = await call("list_refs", { repos: [SECRET] }), missing = await call("list_refs", { repos: ["fixtures.test/nope"] });
  assert.equal(hidden.text.replaceAll(SECRET, "<r>"), missing.text.replaceAll("fixtures.test/nope", "<r>"));
  const repos = Array.from({ length: 57 }, (_, i) => row(`fixtures.test/r${i}`, other));
  let lookups = 0;
  const c: ToolContext = { deps: { getRepo: async (n) => (lookups++, repos.find((r) => r.name === n)), listRepos: async () => repos }, scope: scopeFor(["*"]) };
  const r = await call("list_refs", {}, c);
  assert.ok(lookups <= 50);
  assert.ok(r.json.coverageGaps.includes("7 repositories skipped: at most 50 are read per call"));
});

test("list_refs: an empty repository and a detached one say there are no refs", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grt-"));
  try {
    mk(empty, "init", "-q", "-b", "main");
    const c: ToolContext = { deps: { getRepo: async () => row(R, empty), listRepos: async () => [row(R, empty)] }, scope: scopeFor(["*"]) };
    const e = await refs({}, c);
    assert.deepEqual([e.json.refs, e.json.coverageGaps], [[], []]);
    assert.match(e.json.summary, /No refs/);
    const c1 = commit(empty, "x");
    mk(empty, "checkout", "-q", "--detach");
    mk(empty, "branch", "-q", "-D", "main");
    const d = await refs({ kind: "heads" }, c);
    assert.deepEqual(d.json.refs, []);
    assert.match(d.json.summary, /No branches/);
    assert.deepEqual(names(await refs({ contains: c1 }, c)), []);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test("list_refs: thousands of tags are capped and the answer says how many were cut; the byte cap holds", async () => {
  const many = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grt-"));
  try {
    mk(many, "init", "-q", "-b", "main");
    const head = commit(many, "x");
    execFileSync("git", ["update-ref", "--stdin"], { cwd: many, env: ENV, input: Array.from({ length: 3000 }, (_, i) => `create refs/tags/release-candidate-${i} ${head}\n`).join(""), stdio: "pipe" });
    const c: ToolContext = { deps: { getRepo: async () => row(R, many), listRepos: async () => [row(R, many)] }, scope: scopeFor(["*"]) };
    const r = await refs({ kind: "tags" }, c);
    assert.equal(r.json.refs.length, 100);
    assert.deepEqual(r.json.truncated, ["refs: showing 100 of 3000 found"]);
    const big = await refs({ kind: "tags", count: 500 }, c);
    assert.ok(Buffer.byteLength(big.text) <= 24_000, `${Buffer.byteLength(big.text)}`);
    assert.match(big.json.truncated.join(), /of 3000 found/);
    // the time and byte limits are gaps, not hangs
    const bytes = await refs({ kind: "tags" }, { ...c, deps: { ...c.deps, gitLimits: { repoBytes: 2000 } } });
    assert.deepEqual(bytes.json.coverageGaps, [`${R}: output cut at 2000 bytes; its refs may be missing`]);
    assert.ok(bytes.json.refs.length > 0 && bytes.json.refs.every((x: any) => /^release-candidate-\d+$/.test(x.name) && x.target === head), "the cut last record is dropped");
    const time = await refs({ kind: "tags" }, { ...c, deps: { ...c.deps, gitLimits: { repoMs: 0 } } });
    assert.deepEqual(time.json.coverageGaps, [`${R}: timed out after 0 seconds; its refs may be missing`]);
  } finally { fs.rmSync(many, { recursive: true, force: true }); }
});

test("list_refs: a time limit while resolving the commit is a gap", async () => {
  const t = await refs({ contains: sh.c1 }, ctx({ repoMs: 0 }));
  assert.deepEqual(t.json.refs, []);
  assert.match(t.json.coverageGaps[0], /timed out/);
});

test("list_refs: asks git for only `count` refs per repository; the total still counts every ref", async () => {
  const many = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grt-"));
  try {
    mk(many, "init", "-q", "-b", "main");
    const head = commit(many, "x");
    execFileSync("git", ["update-ref", "--stdin"], { cwd: many, env: ENV, input: Array.from({ length: 3000 }, (_, i) => `create refs/tags/rc-${i} ${head}\n`).join(""), stdio: "pipe" });
    const c: ToolContext = { deps: { getRepo: async () => row(R, many), listRepos: async () => [row(R, many)], gitLimits: { repoBytes: 4000 } }, scope: scopeFor(["*"]) };
    // 3000 full records would not fit in 4000 bytes, so a gap-free answer means git was asked for 5 only
    const r = await refs({ kind: "tags", count: 5 }, c);
    assert.equal(r.json.refs.length, 5);
    assert.deepEqual(r.json.coverageGaps, []);
    assert.deepEqual(r.json.truncated, ["refs: showing 5 of 3000 found"]);
    // the newest come first: with a newer tag on a newer commit, it is in the top 5 whatever its name
    const newer = commit(many, "y");
    mk(many, "tag", "zzz-newest", newer);
    assert.equal((await refs({ kind: "tags", count: 5 }, c)).json.refs[0].name, "zzz-newest");
  } finally { fs.rmSync(many, { recursive: true, force: true }); }
});

test("list_refs: when counting the refs hits the byte limit, the total is a lower bound that never falls below what is shown, and a gap says so", async () => {
  const many = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grt-"));
  try {
    mk(many, "init", "-q", "-b", "main");
    const head = commit(many, "x");
    execFileSync("git", ["update-ref", "--stdin"], { cwd: many, env: ENV, input: Array.from({ length: 3000 }, (_, i) => `create refs/tags/rc-${i} ${head}\n`).join(""), stdio: "pipe" });
    const c: ToolContext = { deps: { getRepo: async () => row(R, many), listRepos: async () => [row(R, many)], gitLimits: { repoBytes: 1000 } }, scope: scopeFor(["*"]) };
    const r = await refs({ kind: "tags", count: 5 }, c); // five records fit in 1000 bytes; the empty-line count of 3000 refs does not
    assert.equal(r.json.refs.length, 5);
    const shown = /^refs: showing 5 of (\d+) found$/.exec(r.json.truncated[0]);
    assert.ok(shown && Number(shown[1]) >= 5 && Number(shown[1]) <= 3000, r.json.truncated[0]);
    assert.deepEqual(r.json.coverageGaps, [`${R}: output cut at 1000 bytes; its refs may be missing`]);
  } finally { fs.rmSync(many, { recursive: true, force: true }); }
});

// A history with a damaged commit: A <- B <- C on main, an unrelated root X, and B's object file overwritten.
function damaged() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-grt-"));
  mk(d, "init", "-q", "-b", "main");
  commit(d, "A");
  const b = commit(d, "B");
  commit(d, "C");
  mk(d, "checkout", "-q", "--orphan", "other");
  const x = commit(d, "X");
  mk(d, "checkout", "-q", "main");
  const file = path.join(d, ".git", "objects", b.slice(0, 2), b.slice(2));
  fs.chmodSync(file, 0o644);
  fs.writeFileSync(file, "garbage");
  return { d, b, x };
}

test("a damaged repository is not 'not found': list_refs gives a gap, check_ancestry rejects", async () => {
  const { d, b } = damaged();
  try {
    const c: ToolContext = { deps: { getRepo: async () => row(R, d), listRepos: async () => [row(R, d)] }, scope: scopeFor(["*"]) };
    const l = await refs({ contains: b }, c);
    assert.deepEqual(l.json.refs, []);
    assert.equal(l.json.coverageGaps.length, 1);
    assert.doesNotMatch(l.json.coverageGaps[0], /not found/);
    await assert.rejects(() => ancestry({ ancestor: b, descendant: "main" }, c), /could not/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("check_ancestry: git failing with a code above 1 rejects; it never reads as 'no'", async () => {
  const { d, x } = damaged();
  try {
    const c: ToolContext = { deps: { getRepo: async () => row(R, d), listRepos: async () => [row(R, d)] }, scope: scopeFor(["*"]) };
    await assert.rejects(() => ancestry({ ancestor: x, descendant: "main" }, c), /could not check whether/); // the walk from main reaches the damaged commit
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---- check_ancestry ----

const verdict = (r: { json: any }) => r.json.result;

test("check_ancestry: yes, no and unresolved, matching git", async () => {
  assert.equal(verdict(await ancestry({ ancestor: sh.c1, descendant: sh.c3 })), "yes", "linear");
  assert.equal(verdict(await ancestry({ ancestor: sh.c3, descendant: sh.c1 })), "no", "the other way round");
  assert.equal(verdict(await ancestry({ ancestor: "feat", descendant: "v-only" })), "yes", "branch to tag");
  assert.equal(verdict(await ancestry({ ancestor: "v2-alias", descendant: "feat" })), "yes", "a tag that points at a tag");
  assert.equal(verdict(await ancestry({ ancestor: sh.c3, descendant: "feat" })), "no", "diverged");
  assert.equal(verdict(await ancestry({ ancestor: sh.c1, descendant: sh.c1 })), "yes", "a commit is its own ancestor");
  assert.equal(verdict(await ancestry({ ancestor: sh.c1, descendant: sh.r1 })), "no", "two unrelated roots");
  assert.equal(verdict(await ancestry({ ancestor: sh.r1, descendant: sh.c1 })), "no");
  const ok = await ancestry({ ancestor: "v1", descendant: "main" });
  assert.deepEqual([ok.json.ancestor, ok.json.descendant], [{ revision: "v1", commit: sh.c1 }, { revision: "main", commit: sh.c3 }]);
  for (const [a, b] of [[sh.c1, sh.c3], [sh.c3, sh.c1], [sh.c1, sh.r1]]) {
    const git = (() => { try { mk(dir, "merge-base", "--is-ancestor", a!, b!); return "yes"; } catch { return "no"; } })();
    assert.equal(verdict(await ancestry({ ancestor: a, descendant: b })), git);
  }
});

test("check_ancestry: a revision that cannot be resolved is its own result and names which one and why", async () => {
  const unknown = await ancestry({ ancestor: "no-such-branch", descendant: "main" });
  assert.equal(verdict(unknown), "unresolved");
  assert.deepEqual(unknown.json.unresolved, [{ revision: "no-such-branch", reason: "not found in this repository" }]);
  const both = await ancestry({ ancestor: sh.o1, descendant: sh.prefix });
  assert.deepEqual(both.json.unresolved.map((u: any) => u.revision), [sh.o1, sh.prefix], "a commit from another repository, an ambiguous prefix");
  assert.match(both.json.unresolved[1].reason, /ambiguous/);
  assert.equal(verdict(await ancestry({ ancestor: "ab", descendant: "main" })), "unresolved", "too short");
  assert.equal(verdict(await ancestry({ ancestor: "main", descendant: "main" })), "yes");
});

test("check_ancestry: option look-alikes are refused, a repository outside the scope is an error, a time limit is an error", async () => {
  const out = path.join(dir, "pwned2");
  for (const bad of ["--all", "-x", `--output=${out}`, "a..b", "", "refs/heads/*", "x y"]) {
    await assert.rejects(() => ancestry({ ancestor: bad, descendant: "main" }), /not accepted/, JSON.stringify(bad));
    await assert.rejects(() => ancestry({ ancestor: "main", descendant: bad }), /not accepted/, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(out), false);
  await assert.rejects(() => call("check_ancestry", { repo: SECRET, ancestor: "main", descendant: "main" }), /not found/);
  await assert.rejects(() => ancestry({ ancestor: "main", descendant: "feat" }, ctx({ repoMs: 0 })), /timed out after 0 seconds/);
});

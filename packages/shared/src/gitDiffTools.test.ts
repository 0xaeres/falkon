import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scopeFor } from "./access";
import { gitToolDefinitions } from "./gitTools";
import type { ToolContext, ToolRepo } from "./tools";

// search_diffs and compare_revisions against real temporary repositories (cycle 19, S76).
const D = "fixtures.test/diffs", OTHER = "fixtures.test/other", SECRET = "fixtures.test/hidden";
let dir: string, other: string;
const sh: Record<string, string> = {};
const mk = (d: string, ...a: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...a], { cwd: d, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: "pipe" }).toString().trim();
const commit = (d: string, name: string, date: string, msg: string, files: Record<string, string | Buffer | null>) => {
  for (const [f, body] of Object.entries(files)) {
    if (body === null) mk(d, "rm", "-q", "-f", f); else { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  }
  mk(d, "add", "-A");
  const env = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@x.test`, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name.toLowerCase()}@x.test`, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-F", "-"], { cwd: d, input: msg, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", ...env }, stdio: "pipe" });
  return mk(d, "rev-parse", "HEAD");
};
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  other = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  mk(dir, "init", "-q", "-b", "main");
  sh.c1 = commit(dir, "Alice", "2024-01-10T12:00:00Z", "first (needle)", { "app.ts": "keep1\nold_api(1)\nkeep2\n", "docs.md": "doc one\ndoc two\ndoc three\ndoc four\n" });
  sh.c2 = commit(dir, "Bob", "2024-02-10T12:00:00Z", "swap the api", { "app.ts": "keep1\nnew_api(1)\nkeep2\n" });
  sh.c3 = commit(dir, "Alice", "2024-03-10T12:00:00Z", "more api", { "app.ts": "keep1\nnew_api(1)\nnew_api(2)\nkeep2\n", "docs.md": "doc one\ndoc two\ndoc three\ndoc four\nmentions OLD_API\n" });
  sh.c4 = commit(dir, "Carol", "2024-04-10T12:00:00Z", "rename docs, add binary", { "docs.md": null, "guide.md": "doc one\ndoc two\ndoc three\ndoc four\nmentions OLD_API\n", "bin.dat": Buffer.from([0, 1, 2, 3, 0, 255]) });
  sh.c5 = commit(dir, "Dave", "2024-05-10T12:00:00Z", "context file", { "ctx.ts": "zzcontext\nA\nB\n" });
  sh.c6 = commit(dir, "Dave", "2024-06-10T12:00:00Z", "touch next to context", { "ctx.ts": "zzcontext\nA\nC\n" });
  mk(other, "init", "-q", "-b", "main");
  sh.o1 = commit(other, "Olga", "2024-07-10T12:00:00Z", "other repo", { "z.ts": "old_api(9)\n" });
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); });

const row = (name: string, p: string): ToolRepo => ({ name, displayName: null, codeHostType: "github", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: p });
const ctx = (gitLimits?: { repoMs?: number; repoBytes?: number }, ...patterns: string[]): ToolContext => {
  const repos = [row(D, dir), row(OTHER, other), row(SECRET, other)];
  return { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, gitLimits }, scope: scopeFor(patterns.length ? patterns : [D, OTHER]) };
};
const call = async (tool: "search_diffs" | "compare_revisions", args: Record<string, unknown>, c = ctx()) => {
  const d = gitToolDefinitions[tool];
  const { output } = await d.execute(d.inputSchema.parse(args) as never, c);
  return { text: output, json: JSON.parse(output) as any };
};
const search = (args: Record<string, unknown>, c = ctx()) => call("search_diffs", { repos: [D], ...args }, c);
const compare = (args: Record<string, unknown>, c = ctx()) => call("compare_revisions", { repo: D, ...args }, c);
const hashes = (r: { json: any }) => r.json.commits.map((c: any) => c.hash);
const refuses = (p: Promise<unknown>, re: RegExp) => assert.rejects(() => p, re);

// ---- search_diffs ----

test("search_diffs: both sides, only added, only removed; each commit says which side matched", async () => {
  const both = await search({ terms: ["old_api"] });
  assert.deepEqual(hashes(both), [sh.c3, sh.c2, sh.c1], "c4 only renames, so no changed line has the term");
  assert.deepEqual(both.json.commits.map((c: any) => c.sides), [["added"], ["removed"], ["added"]]);
  assert.deepEqual(hashes(await search({ terms: ["old_api"], side: "added" })), [sh.c3, sh.c1]);
  assert.deepEqual(hashes(await search({ terms: ["old_api"], side: "removed" })), [sh.c2]);
  const m = both.json.commits[1].matches[0];
  assert.deepEqual([m.file, m.side, m.line, m.text], ["app.ts", "removed", 2, "old_api(1)"]);
  const added = both.json.commits[0].matches[0];
  assert.deepEqual([added.file, added.side, added.line], ["docs.md", "added", 5]);
});

test("search_diffs: a pattern that appears only in context lines does not count", async () => {
  assert.deepEqual(hashes(await search({ terms: ["zzcontext"] })), [sh.c5], "c6 changes a line next to it, but not that line");
  assert.deepEqual(hashes(await search({ terms: ["zzcontext"], side: "removed" })), []);
});

test("search_diffs: files, authors, dates and several terms combine", async () => {
  // c4 renames docs.md away: seen through the path filter alone, it deletes the file, so its removed lines match
  assert.deepEqual(hashes(await search({ terms: ["old_api"], files: ["docs.md"] })), [sh.c4, sh.c3]);
  assert.deepEqual(hashes(await search({ terms: ["old_api"], authors: ["bob"] })), [sh.c2]);
  assert.deepEqual(hashes(await search({ terms: ["old_api"], after: "2024-02-01", before: "2024-02-28" })), [sh.c2]);
  assert.deepEqual(hashes(await search({ terms: ["new_api(2)", "zzcontext"] })), [sh.c5, sh.c3]);
  assert.deepEqual(hashes(await search({ terms: ["old_api"], count: 1 })), [sh.c3]);
  const r = await search({ repos: [D, OTHER], terms: ["old_api"] });
  assert.deepEqual(r.json.commits.map((c: any) => c.repo), [OTHER, D, D, D]);
});

test("search_diffs: terms are plain text, ignore case; revisions are validated; pathspec magic in files is literal", async () => {
  for (const x of [".*", "(", "[", "\\", "a|b", "n.w_api"]) assert.deepEqual(hashes(await search({ terms: [x] })), x === "(" ? [sh.c3, sh.c2, sh.c1] : [], x);
  assert.deepEqual(hashes(await search({ terms: ["NEW_API("] })), [sh.c3, sh.c2]);
  for (const f of [":(top)", ":(glob)*", ":/", ":(top)app.ts"]) assert.deepEqual(hashes(await search({ terms: ["new_api"], files: [f] })), [], f);
  for (const r of ["--all", "main..main", "", "-x", "a b"]) await refuses(search({ terms: ["x"], revisions: [r] }), /not accepted/);
});

test("search_diffs: option look-alikes are plain text; nothing is written", async () => {
  const out = path.join(os.tmpdir(), `falkon-sd-${process.pid}`);
  for (const bad of [`--output=${out}`, "--upload-pack=touch /tmp/pwned", "-p"]) {
    assert.deepEqual(hashes(await search({ terms: [bad] })), [], bad);
    assert.deepEqual(hashes(await search({ terms: ["api"], authors: [bad] })), [], bad);
    assert.deepEqual(hashes(await search({ terms: ["api"], files: [bad] })), [], bad);
  }
  assert.equal(fs.existsSync(out), false);
});

test("search_diffs: no narrowing filter is refused; bad count, side, dates and an empty term list are refused", async () => {
  await refuses(call("search_diffs", { terms: ["api"] }), /narrowing filter/);
  for (const bad of [{ count: 0 }, { count: 101 }, { side: "context" }, { terms: [] }, { terms: [""] }, { terms: ["a\nb"] }]) await assert.rejects(() => search({ terms: ["api"], ...bad }), JSON.stringify(bad));
  await refuses(search({ terms: ["api"], after: "2024-05-01", before: "2024-01-01" }), /later than/);
  await refuses(search({ terms: ["api"], after: "nonsense" }), /not a date/);
});

test("search_diffs: a repository the scope excludes reads like a missing one; more than 50 repositories gives a gap", async () => {
  const hidden = await search({ repos: [SECRET], terms: ["old_api"] });
  const missing = await search({ repos: ["fixtures.test/nope"], terms: ["old_api"] });
  assert.equal(hidden.text.replaceAll(SECRET, "<r>"), missing.text.replaceAll("fixtures.test/nope", "<r>"));
  const repos = Array.from({ length: 57 }, (_, i) => row(`fixtures.test/r${i}`, i % 2 ? dir : other));
  let lookups = 0;
  const c: ToolContext = { deps: { getRepo: async (n) => (lookups++, repos.find((r) => r.name === n)), listRepos: async () => repos }, scope: scopeFor(["*"]) };
  const r = await call("search_diffs", { terms: ["old_api"], after: "2024-01-01" }, c);
  assert.ok(lookups <= 50);
  assert.ok(r.json.coverageGaps.includes("7 repositories skipped: at most 50 are read per call"));
});

test("search_diffs: a repository that hits the time limit, or the byte limit, is a gap and the others still answer", async () => {
  const slow = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  try {
    mk(slow, "init", "-q", "-b", "main");
    commit(slow, "Sam", "2024-08-10T12:00:00Z", "slow", { "a.ts": "old_api\n" });
    mk(slow, "config", "diff.slow.textconv", "sleep 3; cat");
    fs.writeFileSync(path.join(slow, ".git", "info", "attributes"), "*.ts diff=slow\n");
    const fat = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
    mk(fat, "init", "-q", "-b", "main");
    commit(fat, "Fay", "2024-09-01T12:00:00Z", "small", { "f.txt": "old_api\n" });
    commit(fat, "Fay", "2024-09-02T12:00:00Z", "fat", { "f.txt": "old_api\nold_api " + "z".repeat(20_000) + "\n" });
    try {
      const repos = [row(D, dir), row("fixtures.test/slow", slow), row("fixtures.test/fat", fat)];
      const base = { deps: { getRepo: async (n: string) => repos.find((r) => r.name === n), listRepos: async () => repos }, scope: scopeFor(["*"]) };
      const t = await call("search_diffs", { repos: [D, "fixtures.test/slow"], terms: ["old_api"] }, { ...base, deps: { ...base.deps, gitLimits: { repoMs: 1000 } } });
      assert.deepEqual(hashes(t), [sh.c3, sh.c2, sh.c1]);
      assert.deepEqual(t.json.coverageGaps, ["fixtures.test/slow: timed out after 1 seconds; its commits may be missing"]);
      const b = await call("search_diffs", { repos: [D, "fixtures.test/fat"], terms: ["old_api"] }, { ...base, deps: { ...base.deps, gitLimits: { repoBytes: 1500 } } });
      assert.ok(hashes(b).includes(sh.c3) && !b.json.commits.some((c: any) => c.subject === "fat"), "the cut last record is dropped");
      assert.deepEqual(b.json.coverageGaps, ["fixtures.test/fat: output cut at 1500 bytes; its commits may be missing"]);
    } finally { fs.rmSync(fat, { recursive: true, force: true }); }
  } finally { fs.rmSync(slow, { recursive: true, force: true }); }
});

test("search_diffs: matches per commit and line text are bounded and say so; the answer holds the byte cap", async () => {
  const big = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  try {
    mk(big, "init", "-q", "-b", "main");
    for (let i = 0; i < 40; i++) commit(big, "Zed", `2024-07-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`, `change ${i}`, { "f.txt": Array.from({ length: 30 }, (_, k) => `needle ${i} ${k} ${"w".repeat(400)}`).join("\n") + "\n" });
    const c: ToolContext = { deps: { getRepo: async () => row(D, big), listRepos: async () => [row(D, big)] }, scope: scopeFor(["*"]) };
    const r = await search({ terms: ["needle"], count: 40 }, c);
    assert.ok(Buffer.byteLength(r.text) <= 24_000, `${Buffer.byteLength(r.text)}`);
    assert.match(JSON.stringify(r.json.truncated), /byte cap/);
    const one = r.json.commits[0];
    assert.equal(one.matches.length, 5);
    assert.ok(one.matchCount > 5 && one.matches[0].text.length <= 200 && one.matches[0].textCut === true);
  } finally { fs.rmSync(big, { recursive: true, force: true }); }
});

test("search_diffs: changed lines that look like file headers (`++ x`, `-- y`) are content, with their side and line number", async () => {
  const hdr = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  try {
    mk(hdr, "init", "-q", "-b", "main");
    commit(hdr, "Hal", "2024-12-01T12:00:00Z", "start", { "h.txt": "k1\nk2\n-- yy\nk4\n" });
    const c2 = commit(hdr, "Hal", "2024-12-02T12:00:00Z", "swap", { "h.txt": "k1\nk2\n++ xx\nk4\n" });
    const c: ToolContext = { deps: { getRepo: async () => row(D, hdr), listRepos: async () => [row(D, hdr)] }, scope: scopeFor(["*"]) };
    const r = await search({ terms: ["xx", "yy"] }, c);
    assert.deepEqual(hashes(r).slice(0, 1), [c2]);
    assert.deepEqual(r.json.commits[0].matches.map((m: any) => [m.file, m.side, m.line, m.text]), [["h.txt", "removed", 3, "-- yy"], ["h.txt", "added", 3, "++ xx"]]);
  } finally { fs.rmSync(hdr, { recursive: true, force: true }); }
});

// File names git quotes even with core.quotePath=false: a tab, a double quote and a backslash.
const ODD = 'tab\tq"b\\.txt', ODD_DIR = 'd d/in\tner.txt';
test("search_diffs and compare_revisions: file names git quotes are unquoted; a type change keeps the other diffs of the page", async () => {
  const odd = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  try {
    mk(odd, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(odd, "target"), "t\n");
    fs.symlinkSync("target", path.join(odd, "link"));
    const a = commit(odd, "Ivy", "2025-01-01T12:00:00Z", "start", { [ODD]: "one\n", [ODD_DIR]: "in\n", "a-plain.txt": "p\n", "z-plain.txt": "q\n" });
    fs.rmSync(path.join(odd, "link"));
    const b = commit(odd, "Ivy", "2025-01-02T12:00:00Z", "change", { link: "needle now a file\n", [ODD]: "one\nneedle two\n", [ODD_DIR]: "in\nneedle in\n", "a-plain.txt": "p\nneedle a\n", "z-plain.txt": "q\nneedle z\n" });
    const c: ToolContext = { deps: { getRepo: async () => row(D, odd), listRepos: async () => [row(D, odd)] }, scope: scopeFor(["*"]) };

    const s = await search({ terms: ["needle"] }, c);
    assert.deepEqual(s.json.commits[0].matches.map((m: any) => m.file).sort(), [ODD, ODD_DIR, "a-plain.txt", "link", "z-plain.txt"].sort());

    const r = await compare({ base: a, head: b }, c);
    const by = Object.fromEntries(r.json.files.map((f: any) => [f.path, f]));
    assert.deepEqual(r.json.coverageGaps, []);
    assert.equal(by.link.status, "type changed");
    assert.deepEqual([by.link.additions, by.link.deletions], [1, 1]);
    assert.match(by.link.diff, /\+needle now a file/);
    assert.match(by.link.diff, /-target/);
    for (const [f, add] of [[ODD, "needle two"], [ODD_DIR, "needle in"], ["a-plain.txt", "needle a"], ["z-plain.txt", "needle z"]] as const) {
      assert.equal(by[f].diffOmitted, undefined, f);
      assert.match(by[f].diff, new RegExp(`\\+${add}`), f);
      assert.deepEqual([by[f].additions, by[f].deletions], [1, 0], f);
    }
  } finally { fs.rmSync(odd, { recursive: true, force: true }); }
});

// ---- compare_revisions ----

test("compare_revisions: files with status, counts and their diff; rename-only and binary files are listed", async () => {
  const r = await compare({ base: sh.c1, head: sh.c3 });
  assert.deepEqual(r.json.files.map((f: any) => [f.path, f.status, f.additions, f.deletions]), [["app.ts", "modified", 2, 1], ["docs.md", "modified", 1, 0]]);
  assert.match(r.json.files[0].diff, /\+new_api\(2\)/);
  assert.equal(r.json.totalFiles, 2);
  const rb = await compare({ base: sh.c3, head: sh.c4 });
  const by = Object.fromEntries(rb.json.files.map((f: any) => [f.path, f]));
  assert.deepEqual([by["guide.md"].status, by["guide.md"].oldPath, by["guide.md"].additions, by["guide.md"].deletions], ["renamed", "docs.md", 0, 0]);
  assert.deepEqual([by["bin.dat"].status, by["bin.dat"].binary], ["added", true]);
  assert.equal(r.json.base.commit, sh.c1);
});

test("compare_revisions: a revision against itself is empty and says so; a files filter narrows", async () => {
  const same = await compare({ base: "main", head: "main" });
  assert.deepEqual(same.json.files, []);
  assert.match(same.json.summary, /No differences/);
  assert.match((await compare({ base: sh.c1, head: sh.c3 })).text, /app\.ts/);
  const one = await compare({ base: sh.c1, head: sh.c3, files: ["docs.md"] });
  assert.deepEqual(one.json.files.map((f: any) => f.path), ["docs.md"]);
});

test("compare_revisions: unknown revisions, option look-alikes and a commit from another repository are refused", async () => {
  await refuses(compare({ base: "no-such-branch", head: "main" }), /not found/);
  await refuses(compare({ base: sh.o1, head: "main" }), /not found/);
  for (const bad of ["-x", "--output=/tmp/falkon-cr-x", "a..b", "", "refs/heads/*"]) await refuses(compare({ base: bad, head: "main" }), /not accepted/);
  assert.equal(fs.existsSync("/tmp/falkon-cr-x"), false);
  for (const f of [":(top)app.ts", ":(glob)*"]) assert.deepEqual((await compare({ base: sh.c1, head: sh.c3, files: [f] })).json.files, [], f);
  await refuses(compare({ base: sh.c1, head: sh.c3, files: ["../x"] }), /not accepted/);
  await refuses(call("compare_revisions", { repo: SECRET, base: "main", head: "main" }), /not found/);
});

test("compare_revisions: paging (default 50, at most 100 files), a page beyond the last, 101 refused", async () => {
  const many = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  try {
    mk(many, "init", "-q", "-b", "main");
    const a = commit(many, "Mia", "2024-10-01T12:00:00Z", "start", { "start.txt": "s\n" });
    const files = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`d/f${String(i).padStart(3, "0")}.txt`, `v${i}\n`]));
    const b = commit(many, "Mia", "2024-10-02T12:00:00Z", "many", files);
    const c: ToolContext = { deps: { getRepo: async () => row(D, many), listRepos: async () => [row(D, many)] }, scope: scopeFor(["*"]) };
    const p1 = await compare({ base: a, head: b }, c);
    assert.equal(p1.json.files.length, 50); assert.equal(p1.json.totalFiles, 120); assert.equal(p1.json.totalPages, 3);
    const p100 = await compare({ base: a, head: b, perPage: 100 }, c);
    assert.equal(p100.json.files.length <= 100, true); assert.equal(p100.json.totalPages, 2);
    assert.ok(Buffer.byteLength(p100.text) <= 24_000, `${Buffer.byteLength(p100.text)}`);
    const p2 = await compare({ base: a, head: b, perPage: 100, page: 2 }, c);
    assert.deepEqual(p2.json.files.map((f: any) => f.path).slice(0, 2), ["d/f100.txt", "d/f101.txt"]);
    assert.equal(p2.json.files.length, 20);
    const beyond = await compare({ base: a, head: b, page: 4 }, c);
    assert.deepEqual(beyond.json.files, []);
    assert.match(beyond.json.summary, /beyond the last page \(3\)/);
    for (const bad of [{ perPage: 101 }, { perPage: 0 }, { page: 0 }]) await assert.rejects(() => compare({ base: a, head: b, ...bad }, c), JSON.stringify(bad));
  } finally { fs.rmSync(many, { recursive: true, force: true }); }
});

test("compare_revisions: a big file diff is cut in the middle and says so; the answer holds the byte cap", async () => {
  const big = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gdt-"));
  try {
    mk(big, "init", "-q", "-b", "main");
    const a = commit(big, "Zed", "2024-11-01T12:00:00Z", "start", { "s.txt": "s\n" });
    const b = commit(big, "Zed", "2024-11-02T12:00:00Z", "big", { "big.txt": Array.from({ length: 3000 }, (_, i) => `line ${i} ${"q".repeat(50)}`).join("\n") + "\n", "small.txt": "tiny\n" });
    const c: ToolContext = { deps: { getRepo: async () => row(D, big), listRepos: async () => [row(D, big)] }, scope: scopeFor(["*"]) };
    const r = await compare({ base: a, head: b }, c);
    assert.ok(Buffer.byteLength(r.text) <= 24_000);
    const f = Object.fromEntries(r.json.files.map((x: any) => [x.path, x]));
    assert.equal(f["big.txt"].additions, 3000);
    assert.equal(f["big.txt"].diffCut, true);
    assert.match(f["big.txt"].diff, /bytes removed from the middle/);
    assert.match(f["small.txt"].diff, /\+tiny/);
    assert.equal(f["small.txt"].diffCut, undefined);
  } finally { fs.rmSync(big, { recursive: true, force: true }); }
});

test("compare_revisions: a git time limit is an error that names the limit; a byte limit is a gap", async () => {
  await refuses(compare({ base: sh.c1, head: sh.c3 }, ctx({ repoMs: 1 })), /timed out after 0\.001 seconds/);
  const r = await compare({ base: sh.c1, head: sh.c3 }, ctx({ repoBytes: 10 }));
  assert.match(r.json.coverageGaps.join(), /cut at 10 bytes/);
});

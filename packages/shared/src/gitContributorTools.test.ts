import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scopeFor } from "./access";
import { gitToolDefinitions, gitToolNames } from "./gitTools";
import type { ToolContext, ToolRepo } from "./tools";

// list_contributors against real temporary repositories (cycle 19, S80). Expected counts come from `git shortlog -sne`.
const MAP = "fixtures.test/mapped", A = "fixtures.test/team", B = "fixtures.test/side", EMPTY = "fixtures.test/empty", BIG = "fixtures.test/big", SECRET = "fixtures.test/hidden";
let dir: string, other: string, empty: string, big: string, mapped: string;
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
const mk = (d: string, ...a: string[]) => execFileSync("git", a, { cwd: d, env: ENV, stdio: "pipe" }).toString().trim();
/** One commit per entry through fast-import: "Name <email> unixtime file". Entries chain on one branch, oldest first. */
const bulk = (d: string, entries: [string, number, string][]) => {
  const lines = entries.flatMap(([who, ts, file], i) => [`commit refs/heads/main`, `author ${who} ${ts} +0000`, `committer ${who} ${ts} +0000`, `data ${`m${i}`.length}`, `m${i}`, `M 100644 inline ${file}`, `data 1`, `${i % 10}`, ""]);
  execFileSync("git", ["fast-import", "--quiet"], { cwd: d, env: ENV, input: lines.join("\n") + "\n", stdio: ["pipe", "pipe", "pipe"] });
};
const day = (n: number) => Date.UTC(2024, 0, n) / 1000;

before(() => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "falkon-contrib-"));
  [dir, other, empty, big] = [tmp(), tmp(), tmp(), tmp()];
  for (const d of [dir, other, empty, big]) mk(d, "init", "-q", "-b", "main");
  bulk(dir, [
    ["Alice <alice@x.test>", day(1), "src/a.ts"], ["Alice <alice@work.test>", day(2), "src/a.ts"], ["Bob <bob@x.test>", day(3), "docs/b.md"],
    ["Alice <alice@x.test>", day(4), "src/c.ts"], ["alice <alice@x.test>", day(5), "src/c.ts"], ["Bob <bob@x.test>", day(6), "src/a.ts"], ["Carol <carol@x.test>", day(40), "docs/b.md"],
  ]);
  bulk(other, [["Alice <alice@x.test>", day(10), "z.ts"], ["Dave <dave@x.test>", day(11), "z.ts"]]);
  // 1200 commits by 300 identities: enough that a 2000-byte limit stops git inside the list
  bulk(big, Array.from({ length: 1200 }, (_, i): [string, number, string] => [`Dev${i % 300} <dev${i % 300}@x.test>`, day(1) + i, "f.txt"]));
});
before(() => {
  // a bare clone (as Falkon keeps them) of a repository with a .mailmap, a merge commit and a non-ASCII name
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-contrib-src-"));
  mapped = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-contrib-map-"));
  const as = (name: string, email: string, file: string, args: string[] = []) => {
    fs.writeFileSync(path.join(src, file), `${file}\n`);
    mk(src, "add", "-A");
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", file, ...args], { cwd: src, env: { ...ENV, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email }, stdio: "pipe" });
  };
  mk(src, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(src, ".mailmap"), "Zoe Canonical <zoe@canon.test> <zoe@old.test>\n");
  as("Zoë", "zoe@old.test", "a.txt");
  as("Zoë", "zoe@x.test", "b.txt");
  mk(src, "checkout", "-q", "-b", "side");
  as("Bob", "bob@x.test", "s.txt");
  mk(src, "checkout", "-q", "main");
  as("Zoë", "zoe@x.test", "c.txt");
  execFileSync("git", ["-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", "merge side", "side"], { cwd: src, env: { ...ENV, GIT_AUTHOR_NAME: "Bob", GIT_AUTHOR_EMAIL: "bob@x.test", GIT_COMMITTER_NAME: "Bob", GIT_COMMITTER_EMAIL: "bob@x.test" }, stdio: "pipe" });
  execFileSync("git", ["clone", "-q", "--bare", src, mapped], { env: ENV, stdio: "pipe" });
  fs.rmSync(src, { recursive: true, force: true });
});
after(() => { fs.rmSync(mapped, { recursive: true, force: true }); });
after(() => { for (const d of [dir, other, empty, big]) fs.rmSync(d, { recursive: true, force: true }); });

const row = (name: string, p: string): ToolRepo => ({ name, displayName: null, codeHostType: "github", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: p });
const ctx = (gitLimits?: { repoMs?: number; repoBytes?: number }): ToolContext => {
  const repos = [row(A, dir), row(B, other), row(EMPTY, empty), row(BIG, big), row(MAP, mapped), row(SECRET, other)];
  return { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, gitLimits }, scope: scopeFor([A, B, EMPTY, BIG, MAP]) };
};
const contrib = async (args: Record<string, unknown>, c = ctx()) => {
  const d = gitToolDefinitions.list_contributors;
  const { output } = await d.execute(d.inputSchema.parse(args), c);
  return { text: output, json: JSON.parse(output) as any };
};
const shortlog = (d: string, extra: string[] = [], paths: string[] = []) =>
  mk(d, "shortlog", "-sne", ...extra, "HEAD", ...(paths.length ? ["--", ...paths] : [])).split("\n").map((l) => { const m = /^\s*(\d+)\t(.*) <(.*)>$/.exec(l)!; return { name: m[2], email: m[3], commits: Number(m[1]) }; });
const rows = (r: { json: any }) => r.json.authors.map((a: any) => ({ name: a.name, email: a.email, commits: a.commits }));
const byCount = (xs: { name: string; email: string; commits: number }[]) => [...xs].sort((x, y) => y.commits - x.commits || x.name.localeCompare(y.name) || x.email.localeCompare(y.email));

test("list_contributors is the seventh git tool, read-only", () => {
  assert.equal(gitToolNames.at(-1), "list_contributors");
  assert.equal(gitToolDefinitions.list_contributors.isReadOnly, true);
});

test("counts match `git shortlog -sne`; one person under two emails or spellings is counted as git gives them, and the answer says so", async () => {
  const r = await contrib({ repos: [A] });
  assert.deepEqual(rows(r), byCount(shortlog(dir)));
  assert.equal(rows(r).filter((a: any) => a.name.toLowerCase() === "alice").length, 3, "alice@x.test, alice@work.test and the lower-case spelling stay apart");
  assert.match(r.json.summary, /name and email/);
  assert.match(r.json.summary, /separate rows/);
  assert.doesNotMatch(r.json.summary, /PARTIAL/);
  assert.deepEqual(r.json.coverageGaps, []);
});

test("a time window and a path narrow the counts like shortlog does", async () => {
  const r = await contrib({ repos: [A], after: "2024-01-03", before: "2024-01-31" });
  assert.deepEqual(rows(r), byCount(shortlog(dir, ["--since=2024-01-03T00:00:00Z", "--until=2024-01-31T23:59:59Z"])));
  const p = await contrib({ repos: [A], files: ["docs/b.md"] });
  assert.deepEqual(rows(p), byCount(shortlog(dir, [], ["docs/b.md"])));
});

test("several repositories add up; count shows the top few and says how many exist", async () => {
  const r = await contrib({ repos: [A, B], count: 2 });
  assert.deepEqual(rows(r), [{ name: "Alice", email: "alice@x.test", commits: 3 }, { name: "Bob", email: "bob@x.test", commits: 2 }]);
  assert.ok(r.json.truncated.some((t: string) => /showing 2 of 6 found/.test(t)), r.json.truncated.join());
});

test("with `authors`, the answer is the repositories that author works on, with the identities git saw", async () => {
  const r = await contrib({ repos: [A, B, EMPTY], authors: ["alice@x.test"] });
  assert.deepEqual(r.json.repositories.map((x: any) => [x.repo, x.commits]), [[A, 3], [B, 1]]);
  assert.deepEqual(r.json.repositories[0].identities.map((i: any) => [i.name, i.email, i.commits]), [["Alice", "alice@x.test", 2], ["alice", "alice@x.test", 1]]);
  assert.match(r.json.summary, /separate rows|as git gives them|spellings/);
});

test("empty repository, empty window, and a path that never existed give honest empty answers, not errors", async () => {
  const e = await contrib({ repos: [EMPTY] });
  assert.deepEqual(e.json.authors, []);
  assert.match(e.json.summary, /No commits/);
  assert.match(e.json.coverageGaps.concat(e.json.summary).join(" "), /no commits|empty/i);
  const w = await contrib({ repos: [A], after: "2030-01-01" });
  assert.deepEqual(w.json.authors, []);
  assert.match(w.json.summary, /No commits/);
  assert.deepEqual(w.json.coverageGaps, []);
  const p = await contrib({ repos: [A], files: ["no/such/path.ts"] });
  assert.deepEqual(p.json.authors, []);
  assert.match(p.json.summary, /No commits/);
  const a = await contrib({ repos: [A], authors: ["nobody-here"] });
  assert.deepEqual(a.json.repositories, []);
  assert.match(a.json.summary, /No commits/);
});

test("the byte limit stops git inside the list: the result says PARTIAL, drops the cut line and counts only what was read", async () => {
  const full = await contrib({ repos: [BIG], count: 100 });
  assert.deepEqual(rows(full).slice(0, 3).map((x: any) => x.commits), [4, 4, 4]);
  assert.doesNotMatch(full.json.summary, /PARTIAL/);
  const cut = await contrib({ repos: [BIG], count: 100 }, ctx({ repoBytes: 2000 }));
  assert.match(cut.json.summary, /PARTIAL/);
  assert.deepEqual(cut.json.coverageGaps, [`${BIG}: output cut at 2000 bytes; its commits may be missing`]);
  const counted = cut.json.authors.reduce((n: number, a: any) => n + a.commits, 0);
  assert.ok(counted > 0 && counted < 1200, String(counted));
  assert.ok(cut.json.authors.every((a: any) => /^Dev\d+$/.test(a.name) && a.email === `${a.name.toLowerCase()}@x.test`), "no half-read identity");
});

test("the time limit gives a PARTIAL result too, never a complete-looking one", async () => {
  const r = await contrib({ repos: [A] }, ctx({ repoMs: 1 }));
  assert.match(r.json.summary, /PARTIAL/);
  assert.match(r.json.coverageGaps.join(), /timed out after 0.001 seconds; its commits may be missing/);
});

test("a repository outside the scope reads like a missing one; one that cannot be read is a gap and PARTIAL", async () => {
  const r = await contrib({ repos: [A, SECRET] });
  assert.deepEqual(r.json.coverageGaps, [`repository "${SECRET}" not found`]);
  assert.match(r.json.summary, /PARTIAL/);
});

test("option look-alikes in authors and files are plain text; nothing is written; unsafe revisions are refused", async () => {
  const target = path.join(os.tmpdir(), `falkon-contrib-out-${process.pid}`);
  for (const authors of [["--output=" + target], ["--upload-pack=x"], ["-x"]]) assert.deepEqual((await contrib({ repos: [A], authors })).json.repositories, []);
  for (const files of [["--output=" + target], [":(top)a"], [":(glob)*"]]) assert.deepEqual((await contrib({ repos: [A], files })).json.authors, []);
  assert.equal(fs.existsSync(target), false);
  for (const revisions of [["--all"], ["a..b"], [""], ["-x"]]) await assert.rejects(contrib({ repos: [A], revisions }), /not accepted/);
  await assert.rejects(contrib({ repos: [A], files: ["../x"] }), /not accepted/);
  await assert.rejects(contrib({ repos: [A], after: "2024-02-01", before: "2024-01-01" }), /later than/);
  assert.throws(() => gitToolDefinitions.list_contributors.inputSchema.parse({ count: 101 }));
  assert.throws(() => gitToolDefinitions.list_contributors.inputSchema.parse({ count: 0 }));
});

test("the answer holds the byte cap", async () => {
  const r = await contrib({ repos: [BIG], count: 100 });
  assert.ok(Buffer.byteLength(r.text) <= 24_000);
  assert.ok(r.json.truncated.some((t: string) => /showing 100 of 300 found/.test(t)), r.json.truncated.join());
});

test("authors match as plain text: `A.ice` and `.*` match no repository (a regular expression would match)", async () => {
  for (const authors of [["A.ice"], [".*"], ["^Alice$"], ["al[i]ce"]]) assert.deepEqual((await contrib({ repos: [A, B], authors })).json.repositories, [], authors[0]);
  assert.equal((await contrib({ repos: [A], authors: ["ALICE@X.TEST"] })).json.repositories.length, 1, "case is ignored");
});

test("a .mailmap, a merge commit and a non-ASCII name count exactly as `git shortlog -sne` counts them", async () => {
  const want = byCount(shortlog(mapped));
  assert.ok(want.some((w) => w.name === "Zoe Canonical") && want.some((w) => w.name === "Zoë") && want.some((w) => w.name === "Bob"), JSON.stringify(want));
  assert.ok(Number(mk(mapped, "rev-list", "--merges", "--count", "HEAD")) >= 1);
  assert.deepEqual(rows(await contrib({ repos: [MAP] })), want);
});

test("`authors` matches the name and email after the .mailmap, the ones the rows show: the canonical address finds the commits, the replaced one finds nothing", async () => {
  const r = await contrib({ repos: [MAP], authors: ["zoe@canon.test"] });
  assert.deepEqual(r.json.repositories.map((x: any) => [x.repo, x.commits, x.identities[0].name, x.identities[0].email]), [[MAP, 1, "Zoe Canonical", "zoe@canon.test"]]);
  assert.equal((await contrib({ repos: [MAP], authors: ["Zoe Canonical"] })).json.repositories.length, 1);
  assert.deepEqual((await contrib({ repos: [MAP], authors: ["zoe@old.test"] })).json.repositories, []);
  assert.match(gitToolDefinitions.list_contributors.description, /after the `\.mailmap`, the same ones shown in the rows/);
});

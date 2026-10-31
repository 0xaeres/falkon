import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scopeFor } from "./access";
import { gitToolDefinitions, gitToolNames } from "./gitTools";
import type { ToolContext, ToolRepo } from "./tools";

// get_range_history against real temporary repositories (cycle 19, S79). Expected commits come from git itself (`git log -L`).
const R = "fixtures.test/range", SECRET = "fixtures.test/hidden";
let dir: string;
const sh: Record<string, string> = {};
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@x.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@x.test" };
const mk = (d: string, ...a: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...a], { cwd: d, env: ENV, stdio: "pipe" }).toString().trim();
let tick = 0;
const save = (d: string, msg: string, files: Record<string, string | Buffer>) => {
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(d, f), body);
  mk(d, "add", "-A");
  const date = new Date(Date.UTC(2024, 0, 1, 0, 0, ++tick)).toISOString();
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", msg], { cwd: d, env: { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: "pipe" });
  return mk(d, "rev-parse", "HEAD");
};
const lib = (body: string) => `// header\nfunction other() {\n  return 0;\n}\nfunction compute(x) {\n${body}}\nfunction last() {\n  return 9;\n}\n`;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  mk(dir, "init", "-q", "-b", "main");
  sh.h1 = save(dir, "add lib", { "lib.js": lib("  return x + 1;\n") });
  mk(dir, "tag", "v1");
  sh.h2 = save(dir, "change compute", { "lib.js": lib("  return x + 2;\n") });
  sh.h3 = save(dir, "move everything down", { "lib.js": "// a\n// b\n// c\n" + lib("  return x + 2;\n") });
  sh.h4 = save(dir, "compute again", { "lib.js": "// a\n// b\n// c\n" + lib("  return x * 2;\n") });
  mk(dir, "mv", "lib.js", "src.js");
  sh.h5 = save(dir, "rename", {});
  sh.h6 = save(dir, "compute after rename", { "src.js": "// a\n// b\n// c\n" + lib("  const y = x * 3;\n  return y;\n") });
  // regex characters, a leading dash, a name twice, a binary file, a non-ASCII file name
  sh.h7 = save(dir, "odd names", {
    "odd.c": "int axb(void) {\n}\nint a.b(void) {\n  return 1;\n}\nint -dash(void) {\n  return 2;\n}\nint c[0]*x\\y$(void) {\n  return 3;\n}\nint f(g) {\n  return 4;\n}\n",
    "twice.js": "function dup() {\n  return 1;\n}\nfunction mid() {\n}\nfunction dup() {\n  return 2;\n}\n",
    "bin.dat": Buffer.from([0x61, 0, 0x62, 0x0a]),
    "café.ts": "export const a = 1;\n",
  });
  sh.h8 = save(dir, "touch non-ascii", { "café.ts": "export const a = 2;\n" });
  mk(dir, "checkout", "-q", "-b", "side", sh.h2);
  sh.s1 = save(dir, "side work", { "side.js": "function side() {\n  return 1;\n}\n" });
  mk(dir, "checkout", "-q", "main");
  mk(dir, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  sh.merge = mk(dir, "rev-parse", "HEAD");
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const row = (name: string, p: string): ToolRepo => ({ name, displayName: null, codeHostType: "github", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: p });
const ctx = (gitLimits?: { repoMs?: number; repoBytes?: number }, p = dir): ToolContext => {
  const repos = [row(R, p), row(SECRET, p)];
  return { deps: { getRepo: async (n) => repos.find((r) => r.name === n), listRepos: async () => repos, gitLimits }, scope: scopeFor([R]) };
};
const range = async (args: Record<string, unknown>, c = ctx()) => {
  const d = gitToolDefinitions.get_range_history;
  const { output } = await d.execute(d.inputSchema.parse({ repo: R, ...args }) as never, c);
  return { text: output, json: JSON.parse(output) as any };
};
const hashes = (r: { json: any }) => r.json.commits.map((c: any) => c.hash);
/** The commits git itself reports for the same -L argument. */
const gitSays = (arg: string, rev = "HEAD") => mk(dir, "log", "--format=%H", arg, rev).split("\n").filter((l) => /^[0-9a-f]{40}$/.test(l));

test("get_range_history registers after the earlier git tools", () => {
  assert.equal(gitToolNames.at(-1), "get_range_history");
});

test("a function's history: the commits git reports, newest first, through a rename and a move", async () => {
  const r = await range({ file: "src.js", function: "compute" });
  assert.deepEqual(hashes(r), [sh.h6, sh.h4, sh.h2, sh.h1]);
  assert.deepEqual(hashes(r), gitSays("-L:compute:src.js"));
  const by = Object.fromEntries(r.json.commits.map((c: any) => [c.hash, c]));
  assert.equal(by[sh.h6].path, "src.js");
  assert.equal(by[sh.h4].path, "lib.js", "the name the file had then: history followed the rename");
  assert.match(by[sh.h6].diff, /const y = x \* 3;/);
  assert.match(r.json.summary, /rename/i);
  assert.equal(r.json.commits[0].subject, "compute after rename");
  assert.match(r.json.commits[0].date, /^2024-01-01T/);
});

test("a line range's history matches git; the range is taken at the revision asked for", async () => {
  const r = await range({ file: "src.js", startLine: 8, endLine: 9 });
  assert.deepEqual(hashes(r), gitSays("-L8,9:src.js"));
  assert.deepEqual(hashes(r), [sh.h6, sh.h4, sh.h2, sh.h1]);
  const old = await range({ file: "lib.js", startLine: 5, endLine: 6, revision: sh.h2 });
  assert.deepEqual(hashes(old), gitSays("-L5,6:lib.js", sh.h2));
  assert.deepEqual(hashes(old), [sh.h2, sh.h1]);
  assert.equal(old.json.filters.revision.commit, sh.h2);
  assert.deepEqual(hashes(await range({ file: "lib.js", function: "compute", revision: "v1" })), [sh.h1], "a tag works");
});

test("a range that does not exist at the revision says so, and git is not asked for it", async () => {
  const past = await range({ file: "src.js", startLine: 50, endLine: 60 });
  assert.deepEqual(past.json.commits, []);
  assert.match(past.json.summary, /only 14 lines/);
  const clamp = await range({ file: "src.js", startLine: 12, endLine: 90 });
  assert.match(clamp.json.summary, /ends at line 14/);
  assert.deepEqual(hashes(clamp), gitSays("-L12,14:src.js"));
  assert.match((await range({ file: "src.js", function: "nothingLikeThis" })).json.summary, /no line .*contains/i);
  assert.match((await range({ file: "lib.js" , startLine: 1, endLine: 2 })).json.summary, /not a file at/);
  assert.match((await range({ file: "nope/none.js", function: "x" })).json.summary, /not a file at/);
  assert.match((await range({ file: "lib.js", function: "compute", revision: sh.h5 })).json.summary, /not a file at/, "renamed away at that revision");
  assert.match((await range({ file: "src", startLine: 1, endLine: 1 })).json.summary, /not a file at/, "src is not a directory here, but a missing path reads the same");
});

test("a start after the end, line 0, a missing end and mixed modes are refused", async () => {
  await assert.rejects(() => range({ file: "src.js", startLine: 5, endLine: 2 }), /after the end/);
  await assert.rejects(() => range({ file: "src.js", startLine: 0, endLine: 2 }));
  await assert.rejects(() => range({ file: "src.js", startLine: 2 }), /both startLine and endLine/);
  await assert.rejects(() => range({ file: "src.js" }), /either a line range/);
  await assert.rejects(() => range({ file: "src.js", function: "a", startLine: 1, endLine: 2 }), /either a line range/);
  await assert.rejects(() => range({ startLine: 1, endLine: 2 }), /file/);
  await assert.rejects(() => range({ commit: "HEAD", function: "a" }), /commit/);
  await assert.rejects(() => range({ commit: "HEAD", file: "src.js", startLine: 1, endLine: 2 }), /commit/);
});

test("a function name is matched as plain text: regex characters, a leading dash, a name twice", async () => {
  for (const [name, line] of [["a.b", 3], ["-dash", 6], ["c[0]*x\\y$", 9], ["f(g)", 12]] as const) {
    const r = await range({ file: "odd.c", function: name });
    assert.deepEqual(hashes(r), [sh.h7], name);
    assert.match(r.json.commits[0].diff, new RegExp(`@@ -0,0 \\+${line},`), `${name} starts at line ${line}, not at the look-alike line 1 ("axb")`);
  }
  assert.deepEqual((await range({ file: "odd.c", function: "a.*" })).json.commits, [], "a regex is not read as one");
  assert.match((await range({ file: "odd.c", function: ".*" })).json.summary, /no line/i);
  assert.match((await range({ file: "odd.c", function: "a\\|axb" })).json.summary, /no line/i, "a backslash is a backslash");
  await assert.rejects(() => range({ file: "odd.c", function: "A::b" }), /":"/);
  await assert.rejects(() => range({ file: "odd.c", function: "a\nb" }));
  await assert.rejects(() => range({ file: "odd.c", function: "" }));
});

test("a function that exists twice: git follows the first line containing the name, and the answer lists them all", async () => {
  const r = await range({ file: "twice.js", function: "dup" });
  assert.deepEqual(hashes(r), [sh.h7]);
  assert.deepEqual(r.json.filters.target.matchingLines, [1, 6]);
  assert.match(r.json.summary, /line 1/);
  assert.match(r.json.summary, /first/);
  assert.match(r.json.commits[0].diff, /@@ -0,0 \+1,3 @@/);
});

test("a binary file has no line history, and says so", async () => {
  const r = await range({ file: "bin.dat", startLine: 1, endLine: 1 });
  assert.deepEqual(r.json.commits, []);
  assert.match(r.json.summary, /binary/i);
});

test("paths: `..`, a leading ./ or /, a colon and pathspec magic are refused or read literally", async () => {
  for (const f of ["../x.js", "a/../../x.js", "./src.js", "/src.js", "src.js/", "a:b.js", ":(top)src.js", ":(glob)*.js", ":/", "src.js\0"]) await assert.rejects(() => range({ file: f, startLine: 1, endLine: 1 }), `${f}`);
  for (const f of ["*.js", "[a-z]rc.js", "sr?.js", "src.js\\"]) assert.match((await range({ file: f, startLine: 1, endLine: 1 })).json.summary, /not a file at/, f);
});

test("a non-ASCII file name works", async () => {
  const r = await range({ file: "café.ts", startLine: 1, endLine: 1 });
  assert.deepEqual(hashes(r), [sh.h8, sh.h7]);
  assert.equal(r.json.commits[0].path, "café.ts");
});

test("revisions: unknown is an error, option look-alikes are refused and nothing is written, a missing file at an old revision says so", async () => {
  await assert.rejects(() => range({ file: "src.js", function: "compute", revision: "no-such-branch" }), /not found/);
  const out = path.join(os.tmpdir(), `falkon-rng-x-${process.pid}`);
  for (const bad of ["-x", `--output=${out}`, "--upload-pack=touch /tmp/pwned", "a..b", "refs/heads/*", ""]) {
    await assert.rejects(() => range({ file: "src.js", function: "compute", revision: bad }), /not accepted/, bad);
    await assert.rejects(() => range({ commit: bad }), /not accepted/, bad);
  }
  assert.equal(fs.existsSync(out), false);
  await assert.rejects(() => range({ file: "src.js", function: "compute", revision: "0".repeat(40) }), /not found/);
});

test("a repository outside the scope reads like a missing one", async () => {
  await assert.rejects(() => range({ repo: SECRET, file: "src.js", function: "compute" }), /not found/);
  await assert.rejects(() => range({ repo: "fixtures.test/nope", file: "src.js", function: "compute" }), /not found/);
});

// ---- long histories and limits ----

function longRepo(n: number) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  mk(d, "init", "-q", "-b", "main");
  for (let i = 0; i < n; i++) save(d, `edit ${i}`, { "f.js": `function hot() {\n  return ${i};\n}\n` });
  return d;
}

test("a very long history: the commit count is capped, the older commits are a stated gap", async () => {
  const d = longRepo(30);
  try {
    const r = await range({ file: "f.js", function: "hot" }, ctx(undefined, d));
    assert.equal(r.json.commits.length, 20);
    assert.deepEqual(hashes(r), mk(d, "log", "-L:hot:f.js", "--format=%H").split("\n").filter((l) => /^[0-9a-f]{40}$/.test(l)).slice(0, 20));
    assert.match(r.json.coverageGaps.join(), /older commits/);
    const five = await range({ file: "f.js", function: "hot", count: 5 }, ctx(undefined, d));
    assert.equal(five.json.commits.length, 5);
    const all = await range({ file: "f.js", function: "hot", count: 50 }, ctx(undefined, d));
    assert.equal(all.json.commits.length, 30);
    assert.deepEqual(all.json.coverageGaps, []);
    await assert.rejects(() => range({ file: "f.js", function: "hot", count: 51 }));
    await assert.rejects(() => range({ file: "f.js", function: "hot", count: 0 }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("huge diffs: each commit's diff text is cut with a marker and the answer holds the 24 KB cap", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  try {
    mk(d, "init", "-q", "-b", "main");
    const body = (k: number) => "function big() {\n" + Array.from({ length: 400 }, (_, i) => `  line${i} = ${k}${"x".repeat(60)};\n`).join("") + "}\n";
    for (let i = 0; i < 12; i++) save(d, `big ${i}`, { "b.js": body(i) });
    const r = await range({ file: "b.js", function: "big", count: 50 }, ctx(undefined, d));
    assert.ok(Buffer.byteLength(r.text) <= 24_000, `${Buffer.byteLength(r.text)}`);
    assert.ok(r.json.commits.length > 0);
    assert.ok(r.json.commits.every((c: any) => c.diffCut === true && /bytes removed from the middle/.test(c.diff)));
    assert.ok(r.json.commits.every((c: any) => Buffer.byteLength(c.diff) < 3500));
    assert.match(JSON.stringify(r.json.truncated), /byte cap/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("git's byte limit is a gap; its cut last record is dropped, complete ones stay", async () => {
  const d = longRepo(30);
  try {
    const r = await range({ file: "f.js", function: "hot" }, ctx({ repoBytes: 1500 }, d));
    assert.match(r.json.coverageGaps.join(), /output cut at 1500 bytes; its history may be missing/);
    assert.ok(r.json.commits.length > 0 && r.json.commits.length < 20);
    assert.ok(r.json.commits.every((c: any) => /return \d+;/.test(c.diff)));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`git log -L` running long is killed at the time limit and the answer says so", async () => {
  const d = longRepo(3);
  try {
    // git reads the mailmap before it walks any history; a named pipe nobody writes to makes that read, and only that read, wait forever
    execFileSync("mkfifo", [path.join(d, "mailmap.pipe")]);
    mk(d, "config", "log.mailmap", "true");
    mk(d, "config", "mailmap.file", path.join(d, "mailmap.pipe"));
    const t0 = Date.now();
    const r = await range({ file: "f.js", function: "hot" }, ctx({ repoMs: 1000 }, d));
    assert.ok(Date.now() - t0 < 2900, `${Date.now() - t0} ms`);
    assert.match(r.json.coverageGaps.join(), /timed out after 1 seconds; its history may be missing/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---- declarations a commit touched ----

const decls = (r: { json: any }) => Object.fromEntries(r.json.files.map((f: any) => [f.file, f.declarations.map((d: any) => d.declaration)]));

test("a commit's touched declarations are the hunk headers' own text", async () => {
  const r = await range({ commit: sh.h6 });
  assert.deepEqual(decls(r), { "src.js": ["function compute(x) {"] });
  // what git prints in its hunk headers for the same commit
  const headers = mk(dir, "show", "--format=", "-U0", "-M", sh.h6).split("\n").filter((l) => l.startsWith("@@")).map((l) => l.replace(/^@@[^@]*@@ ?/, ""));
  assert.deepEqual(r.json.files[0].declarations.map((d: any) => d.declaration), headers);
  assert.equal(r.json.filters.commit.commit, sh.h6);
  const two = await range({ commit: sh.h1 });
  assert.deepEqual(two.json.files[0].declarations.map((d: any) => d.declaration), [null], "the first lines of a new file have no declaration above them");
});

test("a commit's declarations: several hunks, the file filter, a rename, a merge compared with its first parent, a binary file", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  try {
    mk(d, "init", "-q", "-b", "main");
    const body = (a: string, b: string) => `function one() {\n  ${a}\n}\n${"// pad\n".repeat(8)}function two() {\n  ${b}\n}\n`;
    save(d, "root", { "m.js": body("1;", "2;"), "n.js": body("1;", "2;") });
    const c2 = save(d, "two hunks", { "m.js": body("11;", "22;"), "n.js": body("11;", "2;"), "p.bin": Buffer.from([1, 0, 2]) });
    const r = await range({ commit: c2 }, ctx(undefined, d));
    assert.deepEqual(decls(r), { "m.js": ["function one() {", "function two() {"], "n.js": ["function one() {"], "p.bin": [] });
    assert.equal(r.json.files.find((f: any) => f.file === "p.bin").binary, true);
    assert.deepEqual(decls(await range({ commit: c2, file: "n.js" }, ctx(undefined, d))), { "n.js": ["function one() {"] });
    mk(d, "mv", "n.js", "q.js");
    const c3 = save(d, "rename and edit", { "q.js": body("11;", "33;") });
    assert.deepEqual(decls(await range({ commit: c3 }, ctx(undefined, d))), { "q.js": ["function two() {"] });
    const m = await range({ commit: sh.merge });
    assert.match(m.json.summary, /merge/i);
    assert.deepEqual(decls(m), { "side.js": [null] });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("a commit's declarations: an unknown commit is an error, a commit with no changes says so, a huge commit is capped", async () => {
  await assert.rejects(() => range({ commit: "0".repeat(40) }), /not found/);
  await assert.rejects(() => range({ commit: "no-such-branch" }), /not found/);
  await assert.rejects(() => range({ commit: sh.h6, file: "../x" }));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  try {
    mk(d, "init", "-q", "-b", "main");
    const empty = save(d, "nothing", {});
    assert.match((await range({ commit: empty }, ctx(undefined, d))).json.summary, /no changes/i);
    const files = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`f${i}.js`, `function fn${i}${"y".repeat(80)}() {\n  1;\n}\n`]));
    save(d, "many files", files);
    const second = save(d, "touch them", Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.replace("1;", "2;")])));
    const r = await range({ commit: second }, ctx(undefined, d));
    assert.ok(Buffer.byteLength(r.text) <= 24_000);
    assert.ok(r.json.files.length < 150);
    assert.equal(r.json.truncated[0], "files: showing 100 of 150 found");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---- fix round: entries without hunks, quoted names, a cut first line ----

test("a commit's declarations: a pure rename, a mode-only change and an empty-file add are listed (no hunks), never 'no changes'", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  try {
    mk(d, "init", "-q", "-b", "main");
    save(d, "root", { "old name.js": "function a() {\n  1;\n}\n", "tool.sh": "echo 1\n" });
    mk(d, "mv", "old name.js", "new.js");
    const rename = save(d, "rename only", {});
    const r = await range({ commit: rename }, ctx(undefined, d));
    assert.deepEqual(r.json.files.map((f: any) => [f.file, f.hunks]), [["new.js", 0]]);
    assert.doesNotMatch(r.json.summary, /no changes/);
    fs.chmodSync(path.join(d, "tool.sh"), 0o755);
    const mode = save(d, "mode only", {});
    assert.deepEqual((await range({ commit: mode }, ctx(undefined, d))).json.files.map((f: any) => [f.file, f.hunks]), [["tool.sh", 0]]);
    const empty = save(d, "empty file", { "empty.txt": "" });
    assert.deepEqual((await range({ commit: empty }, ctx(undefined, d))).json.files.map((f: any) => [f.file, f.hunks]), [["empty.txt", 0]]);
    const gone = (() => { mk(d, "rm", "-q", "empty.txt"); return save(d, "delete", {}); })();
    assert.deepEqual((await range({ commit: gone }, ctx(undefined, d))).json.files.map((f: any) => f.file), ["empty.txt"]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// A name git always quotes: a tab, a double quote, a backslash and a control byte (printed as an octal escape).
const ODD = "t\tq\"b\\s\x01.ts";

test("file names git always quotes come back as written, in commit mode and in search_diffs (the decoder is exercised)", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  try {
    mk(d, "init", "-q", "-b", "main");
    save(d, "root", { "plain.ts": "x\n" });
    const c = save(d, "odd name", { [ODD]: "function oddity() {\n  needle;\n}\n" });
    assert.match(mk(d, "show", "--format=", c), /"b\/t\\tq\\"b\\\\s\\001\.ts"/, "git really quotes this name");
    assert.deepEqual((await range({ commit: c }, ctx(undefined, d))).json.files.map((f: any) => f.file), [ODD]);
    const sd = gitToolDefinitions.search_diffs;
    const { output } = await sd.execute(sd.inputSchema.parse({ repos: [R], terms: ["needle"], after: "2000-01-01" }) as never, ctx(undefined, d));
    assert.deepEqual(JSON.parse(output).commits.map((x: any) => x.matches.map((m: any) => m.file)), [[ODD]]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("a commit's declarations: git output cut before its first line break is a gap, not a crash", async () => {
  const r = await range({ commit: sh.h6 }, ctx({ repoBytes: 5 }));
  assert.deepEqual(r.json.files, []);
  assert.match(r.json.coverageGaps.join(), /output cut at 5 bytes; its declarations may be missing/);
  assert.doesNotMatch(r.json.summary, /no changes/);
});

test("a commit's declarations: at most 100 files are listed and the answer says how many were found", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-rng-"));
  try {
    mk(d, "init", "-q", "-b", "main");
    const c = save(d, "many", Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`g${i}.js`, "function g() {\n}\n"])));
    const r = await range({ commit: c }, ctx(undefined, d));
    assert.equal(r.json.files.length, 100);
    assert.deepEqual(r.json.truncated, ["files: showing 100 of 130 found"]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import parseDiff from "parse-diff";
import { simpleGit } from "simple-git";
import { scopeFor } from "./access";
import { toolDefinitions, type ToolContext, type ToolRepo } from "./tools";

const CAP = 30_000;
const REPO = "fixtures.test/diffs";
let dir: string;
const mk = (...a: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=T", "-c", "user.email=t@x.test", ...a], { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: "pipe" }).toString().trim();
const put = (f: string, body: string | Buffer) => fs.writeFileSync(path.join(dir, f), body);
const commitAll = (msg: string) => { mk("add", "-A"); mk("commit", "-qm", msg); return mk("rev-parse", "HEAD"); };
const tag = (n: string) => (mk("tag", "-f", n), n);

/** The get_diff of before this change (no cap, simple-git), kept as the reference for diffs under the cap. */
async function oldGetDiff(base: string, head: string, p?: string) {
  const raw = await simpleGit().cwd(dir).raw(["diff", base, head, ...(p ? ["--", p] : [])]);
  let out = "";
  for (const f of parseDiff(raw)) {
    const oldPath = f.from && f.from !== "/dev/null" ? f.from : null;
    const newPath = f.to && f.to !== "/dev/null" ? f.to : null;
    out += oldPath ? `--- a/${oldPath}\n` : "--- /dev/null\n";
    out += newPath ? `+++ b/${newPath}\n` : "+++ /dev/null\n";
    for (const h of f.chunks) {
      const heading = /^@@ .+ @@ (.+)$/.exec(h.content)?.[1]?.trim();
      const body = h.changes.map((c) => c.content).join("\n");
      out += `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${heading ? ` ${heading}` : ""}\n${body}${body.endsWith("\n") ? "" : "\n"}`;
    }
  }
  return out;
}

const repo: ToolRepo = { name: REPO, displayName: null, codeHostType: "github", webUrl: null, defaultBranch: "main", isFork: false, isArchived: false, pushedAt: null, indexedAt: null, indexedRevisions: [], path: "" };
const ctx = (gitLimits?: { repoMs?: number }): ToolContext => ({ deps: { getRepo: async (n) => (n === REPO ? { ...repo, path: dir } : undefined), listRepos: async () => [{ ...repo, path: dir }], gitLimits }, scope: scopeFor([REPO]) });
const getDiffFull = async (base: string, head: string, p?: string, c = ctx()) => {
  const d = toolDefinitions.get_diff;
  return await d.execute(d.inputSchema.parse({ repo: REPO, base, head, path: p }), c);
};
const getDiff = async (base: string, head: string, p?: string, c = ctx()) => (await getDiffFull(base, head, p, c)).output;
const bytes = (s: string) => Buffer.byteLength(s);

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-gd-"));
  mk("init", "-q", "-b", "main");
  put("small.ts", "one\ntwo\nthree\n");
  put("old-name.txt", "keep me\n".repeat(20));
  put("bin.dat", Buffer.from([0, 1, 2, 3, 0, 255]));
  commitAll("base"); tag("base");
  put("small.ts", "one\nTWO\nthree\nfour\n");
  fs.renameSync(path.join(dir, "old-name.txt"), path.join(dir, "new-name.txt"));
  put("bin.dat", Buffer.from([0, 9, 9, 9, 0, 254, 7]));
  put("café.txt", "naïve résumé\n");
  commitAll("small changes"); tag("small");
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("get_diff: a diff under the cap (edit, rename-only, binary, non-ASCII) is byte-identical to the old output", async () => {
  const now = await getDiff("base", "small");
  assert.equal(now, await oldGetDiff("base", "small"));
  assert.ok(now.includes("--- a/bin.dat\n+++ b/bin.dat\n") && now.includes("--- a/old-name.txt\n+++ b/new-name.txt\n") && now.includes("+naïve résumé"));
  assert.equal(await getDiff("base", "small", "small.ts"), await oldGetDiff("base", "small", "small.ts"));
  assert.equal(await getDiff("small", "small"), "");
});

/** A new file whose formatted diff is exactly `target` bytes (ASCII), found by padding one line. */
async function exactDiff(name: string, target: number) {
  const from = tag("pre-" + name);
  let body = Array.from({ length: 200 }, (_, i) => `row ${i}`).join("\n") + "\n";
  put(name, body); commitAll("probe"); let to = tag("probe-" + name);
  const len0 = bytes(await oldGetDiff(from, to));
  body = body.replace("row 0", "row 0" + "x".repeat(target - len0));
  put(name, body); commitAll("exact"); to = tag("exact-" + name);
  assert.equal(bytes(await oldGetDiff(from, to)), target);
  return { from, to };
}

test("get_diff: exactly the cap passes whole; one byte more is cut with a marker", async () => {
  const at = await exactDiff("at-cap.txt", CAP);
  const whole = await getDiff(at.from, at.to);
  assert.equal(whole, await oldGetDiff(at.from, at.to));
  const over = await exactDiff("over-cap.txt", CAP + 1);
  const cut = await getDiff(over.from, over.to);
  assert.match(cut, /1 bytes removed/);
  assert.ok(bytes(cut) <= CAP + 300);
});

test("get_diff: a big diff keeps the first 75% and the last 25% and states the removed bytes", async () => {
  const from = tag("pre-big");
  put("big.txt", Array.from({ length: 3300 }, (_, i) => `generated line number ${String(i).padStart(5, "0")}`).join("\n") + "\n");
  commitAll("big"); tag("big");
  const full = await oldGetDiff(from, "big");
  const cut = await getDiff(from, "big");
  assert.ok(bytes(full) > CAP * 3 && bytes(full) < 120_000, "stays under the read limit, so the tail is the real end");
  assert.ok(cut.startsWith(full.slice(0, CAP * 0.75)));
  assert.ok(cut.endsWith(full.slice(-CAP * 0.25)));
  assert.match(cut, new RegExp(`${bytes(full) - CAP} bytes removed`));
  assert.ok(bytes(cut) <= CAP + 300);
});

test("get_diff: a huge diff stops git at the read limit and says the end was not read", async () => {
  const from = tag("pre-huge");
  put("huge.txt", Array.from({ length: 200_000 }, (_, i) => `huge ${i}`).join("\n") + "\n"); // ~2 MB
  commitAll("huge"); tag("huge");
  const t0 = Date.now();
  const cut = await getDiff(from, "huge");
  assert.match(cut, /git was stopped after reading 120000 bytes/);
  assert.match(cut, /bytes removed/);
  assert.ok(bytes(cut) <= CAP + 500);
  assert.ok(Date.now() - t0 < 10_000);
});

test("get_diff: one line longer than the cap is cut by bytes, never inside a character, and the cut line is announced", async () => {
  const from = tag("pre-line");
  put("long.txt", "é€😀".repeat(8000) + "\n"); // ~72 KB on one line
  commitAll("long"); tag("long");
  const cut = await getDiff(from, "long");
  assert.ok(!cut.includes("�"));
  assert.match(cut, /may be partial/);
  assert.ok(bytes(cut) <= CAP + 300);
});

test("get_diff: over the cap, sources are exactly the files still visible, and the marker counts the files cut out", async () => {
  const from = tag("pre-many");
  const names = Array.from({ length: 40 }, (_, i) => `f${String(i).padStart(2, "0")}x`);
  for (const n of names) put(`${n}.txt`, Array.from({ length: 150 }, (_, k) => `${n} line ${k}`).join("\n") + "\n");
  commitAll("many"); tag("many");
  const full = await oldGetDiff(from, "many");
  assert.ok(bytes(full) > CAP * 2 && bytes(full) < 120_000);
  const r = await getDiffFull(from, "many");
  const visible = names.filter((n) => r.output.includes(n));
  const listed = (r.sources ?? []).map((s) => (s.type === "file" ? s.path : ""));
  assert.deepEqual(listed, visible.map((n) => `${n}.txt`));
  assert.ok(visible.length > 0 && visible.length < names.length);
  assert.ok(listed.includes("f00x.txt") && listed.includes("f39x.txt") && !listed.includes("f20x.txt"));
  assert.match(r.output, new RegExp(`${names.length - visible.length} file\\(s\\) removed entirely`));
  // a file straddling the head boundary (some lines visible, its last lines cut) keeps its source
  const straddling = visible.filter((n) => full.includes(`${n} line 149\n`) && r.output.includes(`${n} line 0\n`) && !r.output.includes(`${n} line 149\n`));
  assert.ok(straddling.length >= 1);
  for (const n of straddling) assert.ok(listed.includes(`${n}.txt`));
});

test("get_diff: cut offsets count bytes, not characters, so multi-byte text keeps the right sources", async () => {
  const from = tag("pre-mb");
  const names = Array.from({ length: 20 }, (_, i) => `m${String(i).padStart(2, "0")}x`);
  for (const n of names) put(`${n}.txt`, Array.from({ length: 90 }, (_, k) => `${n} é€😀é€😀 line ${k}`).join("\n") + "\n");
  commitAll("multibyte"); tag("mb");
  const full = await oldGetDiff(from, "mb");
  assert.ok(bytes(full) > CAP * 2 && bytes(full) < 120_000 && bytes(full) > full.length * 1.3, "many more bytes than characters");
  const r = await getDiffFull(from, "mb");
  assert.ok(!r.output.includes("�"));
  const visible = names.filter((n) => r.output.includes(n));
  assert.ok(visible.length > 0 && visible.length < names.length);
  assert.deepEqual((r.sources ?? []).map((s) => (s.type === "file" ? s.path : "")), visible.map((n) => `${n}.txt`));
});

test("get_diff: under the cut, renamed and deleted files keep their sources at the ends and lose them in the middle", async () => {
  const from = tag("pre-rd");
  const big = (n: string) => Array.from({ length: 150 }, (_, k) => `${n} line ${k}`).join("\n") + "\n";
  const small = (n: string) => `${n} only\n`.repeat(30); // 100% similar to its renamed self, nothing like the others
  const names = Array.from({ length: 36 }, (_, i) => `b${String(i).padStart(2, "0")}x`);
  for (const n of ["a1-ren-old", "a2-del", "b17-ren-old", "b18-del", "z1-ren-old", "z2-del"]) put(`${n}.txt`, small(n));
  commitAll("small ones"); tag("rd-base");
  for (const n of names) put(`${n}.txt`, big(n));
  for (const n of ["a1-ren", "b17-ren", "z1-ren"]) fs.renameSync(path.join(dir, `${n}-old.txt`), path.join(dir, `${n}-new.txt`));
  for (const n of ["a2-del", "b18-del", "z2-del"]) fs.rmSync(path.join(dir, `${n}.txt`));
  commitAll("renames, deletes and bulk"); tag("rd");
  const full = await oldGetDiff("rd-base", "rd");
  assert.ok(bytes(full) > CAP * 2 && bytes(full) < 120_000);
  const r = await getDiffFull("rd-base", "rd");
  const src = (r.sources ?? []).flatMap((s) => (s.type === "file" ? [`${s.path}@${s.revision}`] : []));
  assert.deepEqual(src.filter((s) => /^(a|z)\d-/.test(s)), ["a1-ren-old.txt@rd-base", "a1-ren-new.txt@rd", "a2-del.txt@rd-base", "z1-ren-old.txt@rd-base", "z1-ren-new.txt@rd", "z2-del.txt@rd-base"]);
  assert.ok(!src.some((s) => s.startsWith("b17-") || s.startsWith("b18-")), "the middle ones were cut out");
  assert.ok(r.output.includes("--- a/a1-ren-old.txt\n+++ b/a1-ren-new.txt\n") && !r.output.includes("b17-ren"));
});

test("get_diff: when git was stopped early, the removed-file count says it covers only the part git read", async () => {
  const from = tag("pre-many2");
  for (let i = 0; i < 200; i++) put(`g${i}.txt`, Array.from({ length: 60 }, (_, k) => `g${i} line ${k}`).join("\n") + "\n");
  commitAll("many2"); tag("many2");
  const r = await getDiffFull(from, "many2");
  assert.match(r.output, /\d+ file\(s\) removed entirely \(among the files git read before it was stopped\)/);
  assert.ok((r.sources ?? []).length < 200);
});

test("get_diff: a git timeout is reported as a timeout, not a hang", async () => {
  await assert.rejects(() => getDiff("base", "small", undefined, ctx({ repoMs: 1 })), /timed out/);
});

test("get_diff: an unknown revision, an option look-alike and a path flag fail without running git as an option", async () => {
  await assert.rejects(() => getDiff("base", "no-such-rev"), /no-such-rev|diff/);
  await assert.rejects(() => getDiff("--output=/tmp/falkon-gd-x", "small"), /Invalid git reference/);
  await assert.rejects(() => getDiff("base", "--no-index"), /Invalid git reference/);
  assert.equal(fs.existsSync("/tmp/falkon-gd-x"), false);
});

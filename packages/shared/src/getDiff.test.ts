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
const getDiff = async (base: string, head: string, p?: string, c = ctx()) => {
  const d = toolDefinitions.get_diff;
  return (await d.execute(d.inputSchema.parse({ repo: REPO, base, head, path: p }), c)).output;
};
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

test("get_diff: a git timeout is reported as a timeout, not a hang", async () => {
  await assert.rejects(() => getDiff("base", "small", undefined, ctx({ repoMs: 1 })), /timed out/);
});

test("get_diff: an unknown revision, an option look-alike and a path flag fail without running git as an option", async () => {
  await assert.rejects(() => getDiff("base", "no-such-rev"), /no-such-rev|diff/);
  await assert.rejects(() => getDiff("--output=/tmp/falkon-gd-x", "small"), /Invalid git reference/);
  await assert.rejects(() => getDiff("base", "--no-index"), /Invalid git reference/);
  assert.equal(fs.existsSync("/tmp/falkon-gd-x"), false);
});

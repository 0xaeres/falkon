// Pull request import over a real temporary git repository and recorded snapshot pages (no network): the linker rules,
// verification against the clone, idempotent re-import and comment replacement. Runs on the in-memory store, and on
// Postgres too when PROVENANCE_TEST_DATABASE_URL is set.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ProvenanceStore } from "@falkon/shared";
import { fakeProvenanceStore } from "../../shared/src/provenance.fake";
import { MAX_TEXT, importDiscussions, snapshotSource } from "./discussions";
import { pgClose, pgSkip, pgTestStore } from "./provenancePg.testing";

const APP = "example.test/acme/app", LIB = "example.test/acme/lib", BARE = "example.test/acme/bare";
const SET = [APP, LIB, BARE];
const KEYS = ["TRUNK", "RESTWS", "O3"];

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "D", GIT_AUTHOR_EMAIL: "d@example.test", GIT_COMMITTER_NAME: "D", GIT_COMMITTER_EMAIL: "d@example.test" };

/** A repository with one pull request merged each way GitHub merges, plus a force-pushed and a stale branch. */
function seedRepo(tag: string) {
  const dir = tmp("falkon-prs-");
  const git = (...a: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...a], { cwd: dir, env, encoding: "utf8" }).trim();
  let n = 0;
  const commit = (msg: string) => { fs.writeFileSync(path.join(dir, `f${n++}.txt`), tag + msg); git("add", "."); git("commit", "-qm", msg); return git("rev-parse", "HEAD"); };
  git("init", "-q", "-b", "main");
  commit("initial");
  const s1 = commit("Add login (#1)"); // squash merge of #1, which GitHub records as its merge commit
  const s2 = commit("Fix typo (#2)"); // squash merge of #2, whose record lacks the merge commit
  git("checkout", "-qb", "feature");
  const f1 = commit("feature work");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "feature", "-m", "Merge pull request #3 from acme/feature");
  const m3 = git("rev-parse", "HEAD");
  git("checkout", "-qb", "feat4"); commit("more work"); git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "feat4", "-m", "Merge pull request #4 from acme/feat4");
  const m4 = git("rev-parse", "HEAD");
  const r1 = commit("step one"), r2 = commit("step two"); // #5 rebased onto main: GitHub records the last commit
  const n99 = commit("Unrelated (#99)"); // names a pull request the snapshot does not have
  const head = git("rev-parse", "HEAD");
  git("checkout", "-qb", "pr6");
  const forced = commit("first push of #6");
  git("reset", "-q", "--hard", "main");
  const pushed = commit("second push of #6"); // the first push is now unreachable from any branch
  git("checkout", "-qb", "stale", "main");
  const stale = commit("never merged");
  git("checkout", "-q", "main");
  return { dir, head, s1, s2, f1, m3, m4, r1, r2, n99, forced, pushed, stale };
}

const pull = (number: number, o: Record<string, unknown> = {}) => ({
  number, title: `PR ${number}`, body: "", state: "closed", merged: true, mergedAt: "2025-01-02T00:00:00Z", createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-02T00:00:00Z", closedAt: "2025-01-02T00:00:00Z", authorLogin: "dev", headRef: `branch-${number}`, baseRef: "main",
  mergeCommitSha: null, url: `https://github.com/acme/app/pull/${number}`, labels: [], comments: [], reviews: [], reviewComments: [], files: [], truncated: {}, ...o,
});
function writeSnapshot(root: string, repo: string, pulls: ReturnType<typeof pull>[]) {
  const dir = path.join(root, repo, "pulls");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, repo, "_meta.json"), JSON.stringify({ repo, owner: "acme" }));
  for (const p of pulls) fs.writeFileSync(path.join(dir, `${p.number}.json`), JSON.stringify(p));
}

const g = seedRepo("app");
const lib = seedRepo("lib");
const comment = (id: number, body: string, at = "2025-01-01T12:00:00Z") => ({ id, authorLogin: "rev", body, createdAt: at, updatedAt: at });
const appPulls = () => [
  pull(1, { mergeCommitSha: g.s1, body: "Adds login. Fixes O3-100" }),
  pull(2, { body: "typo" }),
  pull(3, { mergeCommitSha: g.m3, headRef: "TRUNK-30-feature" }),
  pull(4),
  pull(5, { mergeCommitSha: g.r2 }),
  pull(6, { state: "open", merged: false, mergedAt: null, closedAt: null, headRef: "pr6", updatedAt: "2025-01-03T00:00:00Z" }),
  pull(7, { mergeCommitSha: g.stale }),
  pull(8, { body: "Fixes TRUNK-10 and RESTWS-20, follows #1", comments: [comment(81, "first"), comment(82, "second")], reviews: [{ id: 83, authorLogin: "rev", state: "APPROVED", body: "", submittedAt: "2025-01-01T13:00:00Z" }], reviewComments: [{ id: 84, authorLogin: "rev", body: "nit", path: "f1.txt", line: 1, createdAt: "2025-01-01T14:00:00Z", updatedAt: "2025-01-01T14:00:00Z" }], files: [{ path: "f1.txt", additions: 1, deletions: 0 }] }),
  pull(9, { title: "", body: null }),
  pull(10, { body: "x".repeat(70_000), comments: [comment(101, "y".repeat(70_000))], truncated: { comments: true, files: true }, files: [{ path: "big", additions: 9, deletions: 9 }] }),
  pull(11, { mergeCommitSha: "e".repeat(40) }),
];

function setup() {
  const snap = tmp("falkon-snapshot-");
  writeSnapshot(snap, "app", appPulls());
  writeSnapshot(snap, "lib", [pull(1, { title: "lib one", mergeCommitSha: lib.s1 })]);
  return snap;
}

type Make = (names: string[]) => Promise<{ store: ProvenanceStore; id: (n: string) => number }>;
const variants: [string, Make, boolean | string][] = [
  ["fake store", async (names) => { const ids = Object.fromEntries(names.map((n, i) => [n, i + 1])); return { store: fakeProvenanceStore(ids), id: (n) => ids[n]! }; }, false],
  ["postgres", pgTestStore, pgSkip],
];
after(() => pgClose());

for (const [label, make, skip] of variants) {
  const run = async (store: ProvenanceStore, id: (n: string) => number, snap: string) => {
    const src = snapshotSource(snap);
    return {
      app: await importDiscussions(store, src, { id: id(APP), name: APP, dir: g.dir, head: g.head }, KEYS),
      lib: await importDiscussions(store, src, { id: id(LIB), name: LIB, dir: lib.dir, head: lib.head }, KEYS),
      bare: await importDiscussions(store, src, { id: id(BARE), name: BARE, dir: g.dir, head: g.head }, KEYS),
    };
  };
  const commitLinksOf = async (store: ProvenanceStore, n: number, repo = APP) =>
    (await store.links(SET, { kind: "pr", repo, number: n }, { unverified: true })).links.filter((l) => l.fromKind === "commit").map((l) => [l.fromRef, l.source, l.verified]);

  test(`${label}: squash, merge-commit, rebase and force-pushed pull requests link to the right commits`, { skip }, async () => {
    const { store, id } = await make(SET);
    const r = await run(store, id, setup());
    assert.deepEqual([r.app?.imported, r.app?.total, r.lib?.imported, r.bare], [11, 11, 1, undefined]);
    assert.deepEqual(await commitLinksOf(store, 1), [[g.s1, "merge-commit-sha", true]], "squash: the merge commit rule wins over the (#1) subject");
    assert.deepEqual(await commitLinksOf(store, 2), [[g.s2, "squash-subject", true]]);
    assert.deepEqual(await commitLinksOf(store, 3), [[g.m3, "merge-commit-sha", true]], "merge commit, not the feature commit");
    assert.deepEqual(await commitLinksOf(store, 4), [[g.m4, "merge-subject", true]]);
    assert.deepEqual(await commitLinksOf(store, 5), [[g.r2, "merge-commit-sha", true]], "rebase: the recorded last commit only");
    assert.deepEqual(await commitLinksOf(store, 6), [], "force-pushed open pull request: its head commits are never provenance");
    assert.deepEqual(await commitLinksOf(store, 7), [[g.stale, "merge-commit-sha", false]], "in the clone but not on the indexed head");
    assert.deepEqual(await commitLinksOf(store, 11), [["e".repeat(40), "merge-commit-sha", false]], "not in the clone");
    for (const sha of [g.f1, g.r1, g.n99, g.forced, g.pushed]) assert.deepEqual((await store.links(SET, { kind: "commit", sha }, { unverified: true })).links, [], sha);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: g.stale })).links, [], "unverified links are hidden by default");
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: g.s1 })).links.map((l) => [l.repo, l.toRef]), [[APP, "1"]]);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: lib.s1 })).links.map((l) => [l.repo, l.toRef]), [[LIB, "1"]], "same number, other repository");
    assert.equal((await store.getDiscussion(SET, LIB, 1) as { title: string }).title, "lib one");
    assert.equal((await store.getDiscussion(SET, APP, 1) as { title: string }).title, "PR 1");
  });

  test(`${label}: ticket keys and body references; empty body; very large pull request flagged; never-imported repository is a gap`, { skip }, async () => {
    const { store, id } = await make(SET);
    await run(store, id, setup());
    const to = async (n: number) => (await store.links(SET, { kind: "pr", repo: APP, number: n })).links.filter((l) => l.fromKind === "pr" && l.fromRef === String(n)).map((l) => `${l.toKind}:${l.toRef}`).sort();
    assert.deepEqual(await to(8), ["pr:1", "ticket:RESTWS-20", "ticket:TRUNK-10"], "both ticket keys");
    assert.deepEqual(await to(1), ["ticket:O3-100"]);
    assert.deepEqual(await to(3), ["ticket:TRUNK-30"], "from the head branch name");
    assert.deepEqual(await to(9), []);
    const empty = await store.getDiscussion(SET, APP, 9);
    assert.ok(empty && !("gap" in empty) && empty.body === "" && empty.title === "");
    const big = await store.getDiscussion(SET, APP, 10);
    assert.ok(big && !("gap" in big));
    assert.deepEqual([big.body.length, big.comments[0]!.body.length, big.truncated], [65_536, 65_536, ["body", "commentBodies", "comments", "files"]]);
    const eight = await store.getDiscussion(SET, APP, 8);
    assert.ok(eight && !("gap" in eight));
    assert.deepEqual(eight.comments.map((c) => [c.externalId, c.kind]), [["81", "issue_comment"], ["82", "issue_comment"], ["83", "review"], ["84", "review_comment"]]);
    assert.deepEqual(await store.getDiscussion(SET, BARE, 1), { gap: `pull requests not ingested for ${BARE}` });
    assert.deepEqual((await store.links(SET, { kind: "ticket", key: "TRUNK-10" })).gaps, [`pull requests not ingested for ${BARE}`]);
  });

  test(`${label}: re-import is idempotent; an edited and a deleted comment are replaced`, { skip }, async () => {
    const { store, id } = await make(SET);
    const snap = setup();
    await run(store, id, snap);
    const dump = async () => Promise.all([...Array(12).keys()].map(async (n) => [await store.getDiscussion(SET, APP, n), await store.links(SET, { kind: "pr", repo: APP, number: n }, { unverified: true })]));
    const first = await dump();
    const again = await run(store, id, snap);
    assert.deepEqual([again.app?.imported, again.app?.commitLinks], [1, 7], "only the newest pull request (at the cursor) is read again; links recomputed");
    assert.deepEqual(await dump(), first);
    const state = await store.syncState(id(APP));
    assert.deepEqual([state?.status, state?.error, state?.importedCount, state?.headCommit, state?.cursorUpdatedAt], ["ok", null, 11, g.head, new Date("2025-01-03T00:00:00Z")]);
    writeSnapshot(snap, "app", [pull(8, { body: "Fixes TRUNK-10 only", updatedAt: "2025-02-01T00:00:00Z", comments: [comment(81, "first, edited")] })]);
    const third = await run(store, id, snap);
    assert.equal(third.app?.imported, 2, "#8 and #6 at the old cursor");
    const eight = await store.getDiscussion(SET, APP, 8);
    assert.ok(eight && !("gap" in eight));
    assert.deepEqual(eight.comments.map((c) => [c.externalId, c.body]), [["81", "first, edited"]]);
    assert.deepEqual(eight.files, []);
    assert.deepEqual((await store.links(SET, { kind: "pr", repo: APP, number: 8 })).links.filter((l) => l.fromKind === "pr").map((l) => l.toRef), ["TRUNK-10"]);
  });

  test(`${label}: a failed import leaves a fixed error and the repository a coverage gap`, { skip }, async () => {
    const { store, id } = await make(SET);
    await assert.rejects(importDiscussions(store, snapshotSource(setup()), { id: id(APP), name: APP, dir: g.dir, head: null }, KEYS));
    const state = await store.syncState(id(APP));
    assert.deepEqual([state?.status, state?.error, state?.lastSuccessAt], ["failed", "import failed", null]);
    assert.deepEqual(await store.getDiscussion(SET, APP, 1), { gap: `pull requests not ingested for ${APP}` });
  });

  test(`${label}: an odd pull request is cleaned or skipped and counted; the rest imports and the repository is no gap`, { skip }, async () => {
    const { store, id } = await make(SET);
    const snap = tmp("falkon-snapshot-");
    const emoji = "a".repeat(MAX_TEXT - 1) + "\u{1F600}tail"; // the cut at MAX_TEXT falls inside the surrogate pair
    writeSnapshot(snap, "app", [
      pull(20, { title: "a\u0000b", body: "x\u0000y", comments: [comment(201, "c\u0000d"), comment(202, "lone \uD800 surrogate")] }),
      pull(21, { body: emoji }),
      pull(23, { createdAt: "not a date" }),
      pull(24, { mergedAt: "garbage", closedAt: "2025-13-45T00:00:00Z" }),
      pull(25, { files: [{ path: "a", additions: 1.5, deletions: 3e9 }, { path: "b", additions: "7", deletions: -1 }], reviewComments: [{ id: 251, authorLogin: "r", body: "x", path: "a", line: 2.5, createdAt: "2025-01-01T00:00:00Z", updatedAt: "nope" }] }),
      pull(26, { mergeCommitSha: g.r1 }),
      pull(27, { mergeCommitSha: g.r1 }),
    ]);
    fs.writeFileSync(path.join(snap, "app", "pulls", "22.json"), "{not json");
    fs.writeFileSync(path.join(snap, "app", "pulls", "030.json"), JSON.stringify(pull(30, { title: "zero padded" })));
    fs.writeFileSync(path.join(snap, "app", "pulls", "31.json"), JSON.stringify(pull(1e12)));
    const target = { id: id(APP), name: APP, dir: g.dir, head: g.head };
    const r = await importDiscussions(store, snapshotSource(snap), target, KEYS);
    assert.deepEqual([r?.imported, r?.skipped], [7, 3], "22 (JSON), 23 (date) and 31 (number above int4) skipped");
    const state = await store.syncState(id(APP));
    assert.deepEqual([state?.status, state?.error, state?.skippedCount, state?.cursorUpdatedAt], ["ok", null, 3, null], "the cursor waits until nothing is skipped");
    const get = async (n: number) => { const d = await store.getDiscussion(SET, APP, n); assert.ok(d && !("gap" in d), String(n)); return d; };
    const nul = await get(20);
    assert.deepEqual([nul.title, nul.body, nul.comments.map((c) => c.body)], ["ab", "xy", ["cd", "lone \uFFFD surrogate"]]);
    const cut = await get(21);
    assert.deepEqual([cut.body.length, cut.body.endsWith("a"), cut.truncated], [MAX_TEXT - 1, true, ["body"]]);
    const dates = await get(24);
    assert.deepEqual([dates.mergedAt, dates.closedAt], [null, null]);
    const nums = await get(25);
    assert.deepEqual(nums.files.map((f) => [f.path, f.additions, f.deletions]), [["a", 0, 0], ["b", 0, 0]]);
    assert.deepEqual([nums.comments[0]!.line, nums.comments[0]!.updatedAt], [null, null]);
    assert.equal((await get(30)).title, "zero padded");
    assert.equal(await store.getDiscussion(SET, APP, 23), undefined);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: g.r1 })).links.map((l) => l.toRef).sort(), ["26", "27"], "two pull requests recording one merge commit are both linked");
    assert.deepEqual((await importDiscussions(store, snapshotSource(snap), target, KEYS))?.skipped, 3, "still counted on the next run");
  });
}

test("the snapshot source reads only a directory whose metadata names the repository's owner", async () => {
  const snap = setup();
  const src = snapshotSource(snap);
  assert.equal(await src.covers(APP), true);
  assert.equal(await src.covers("example.test/other/app"), false, "same name, other owner");
  assert.equal(await src.covers("example.test/acme/.."), false);
  assert.equal(await src.covers("app"), false);
  const numbers: number[] = [];
  for await (const d of src.pulls(APP, new Date("2025-01-03T00:00:00Z"))) if (!("skipped" in d)) numbers.push(d.number);
  assert.deepEqual(numbers, [6]);
});

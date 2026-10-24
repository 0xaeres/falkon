import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { NoAccess, RateLimited, type DiscussionSource, type GithubConnectionConfig, type SyncState } from "@falkon/shared";
import { fakeProvenanceStore } from "../../shared/src/provenance.fake";
import type { ImportTarget } from "./discussions";
import { discussionConnection, planDiscussionSync, runDiscussionJob, type PlanRepo } from "./discussionSchedule";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const now = new Date("2026-03-01T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const opts = { now, intervalMs: 15 * MIN, reconcileMs: 7 * DAY, snapshot: false };
const gh: GithubConnectionConfig = { type: "github", token: { env: "T" }, discussions: true };
const state = (o: Partial<SyncState> = {}): SyncState => ({ cursorUpdatedAt: null, lastRunAt: ago(DAY), lastSuccessAt: ago(DAY), headCommit: "a".repeat(40), status: "ok", error: null, importedCount: 0, skippedCount: 0, access: "ok", waitUntil: null, reconciledAt: ago(DAY), ...o });
const repo = (id: number, o: Partial<PlanRepo> = {}): PlanRepo => ({ id, indexed: true, headCommit: "a".repeat(40), connections: [{ config: gh }], state: state(), ...o });
const ids = (rs: PlanRepo[], o = {}) => planDiscussionSync(rs, { ...opts, ...o }).map((j) => j.repoId);

test("a repository with no sync state is due; a fresh run is not", () => {
  assert.deepEqual(ids([repo(1, { state: undefined }), repo(2, { state: state({ lastRunAt: ago(MIN) }) }), repo(3, { state: state({ lastRunAt: ago(16 * MIN) }) })]), [1, 3]);
});

test("a thousand repositories due at once: bounded per tick, oldest run first, never run before unseen", () => {
  const rs = Array.from({ length: 1000 }, (_, i) => repo(i + 1, { state: state({ lastRunAt: ago(DAY + i * MIN) }) }));
  rs.push(repo(5000, { state: undefined }));
  const plan = ids(rs);
  assert.equal(plan.length, 20);
  assert.equal(plan[0], 5000); // never synced goes first
  assert.deepEqual(plan.slice(1, 4), [1000, 999, 998]); // then the oldest runs
  assert.equal(ids(rs, { limit: 5 }).length, 5);
});

test("job id dedupes per repository per interval bucket", () => {
  const [a] = planDiscussionSync([repo(1, { state: undefined })], opts);
  const [b] = planDiscussionSync([repo(1, { state: undefined })], { ...opts, now: new Date(now.getTime() + MIN) });
  const [c] = planDiscussionSync([repo(1, { state: undefined })], { ...opts, now: new Date(now.getTime() + 15 * MIN) });
  assert.equal(a!.jobId, b!.jobId);
  assert.notEqual(a!.jobId, c!.jobId);
});

test("a waiting repository is skipped before waitUntil and due after it once its interval is up", () => {
  const w = (waitUntil: Date) => repo(1, { state: state({ status: "waiting", waitUntil, lastRunAt: ago(HOUR) }) });
  assert.deepEqual(ids([w(new Date(now.getTime() + MIN))]), []);
  assert.deepEqual(ids([w(ago(MIN))]), [1]);
});

test("no discussions flag, no token, not indexed, no head: never enqueued", () => {
  const off = { config: { ...gh, discussions: false } };
  const unset = { config: { type: "github", token: { env: "T" } } };
  const noToken = { config: { type: "github", discussions: true } };
  const git = { config: { type: "git", url: "https://x.io/r.git" } };
  assert.deepEqual(ids([repo(1, { connections: [off] }), repo(2, { connections: [unset] }), repo(3, { connections: [noToken] }), repo(4, { connections: [git] }), repo(5, { indexed: false }), repo(6, { headCommit: null }), repo(7, { connections: [] })]), []);
  assert.deepEqual(ids([repo(8, { connections: [off, { config: gh }] })]), [8]); // any enabled connection with a token
});

test("snapshot dir set: nothing is enqueued", () => {
  assert.deepEqual(ids([repo(1, { state: undefined })], { snapshot: true }), []);
});

test("no-access repository is re-probed at most once an hour", () => {
  const na = (lastRunAt: Date) => repo(1, { state: state({ access: "no-access", lastRunAt }) });
  assert.deepEqual(ids([na(ago(30 * MIN))]), []);
  assert.deepEqual(ids([na(ago(61 * MIN))]), [1]);
});

test("reconcile mode when reconciledAt is missing or older than the reconcile interval", () => {
  const mode = (reconciledAt: Date | null) => planDiscussionSync([repo(1, { state: state({ reconciledAt, lastRunAt: ago(DAY) }) })], opts)[0]!.reconcile;
  assert.equal(mode(null), true);
  assert.equal(mode(ago(8 * DAY)), true);
  assert.equal(mode(ago(6 * DAY)), false);
});

test("discussionConnection returns the first enabled github connection with a token", () => {
  assert.equal(discussionConnection([{ config: { ...gh, discussions: false } }]), undefined);
  assert.deepEqual(discussionConnection([{ config: { ...gh, discussions: false } }, { config: gh }]), gh);
});

// ---- the job ------------------------------------------------------------------------------------

const target: ImportTarget = { id: 1, name: "o/r", dir: "/nope", head: null };
const run = (source: DiscussionSource, o: { conn?: unknown; reconcile?: boolean; seed?: SyncState; target?: typeof target } = {}) => {
  const store = fakeProvenanceStore({ "o/r": 1 });
  const added: { data: unknown; id: string; delay: number }[] = [];
  const promise = (async () => {
    if (o.seed) await store.saveSyncState(1, o.seed);
    return runDiscussionJob({ store, target: o.target ?? target, conn: "conn" in o ? (o.conn as any) : gh, reconcile: o.reconcile ?? false, makeSource: async () => source, requeue: async (data, id, delay) => void added.push({ data, id, delay }), now: () => now, ticketKeys: [] });
  })();
  return { store, added, promise };
};
const empty: DiscussionSource = { covers: async () => true, async *pulls() {} };

test("job with the flag turned off mid-run: builds no source, writes nothing", async () => {
  let built = false;
  const r = run({ covers: async () => (built = true) } as any, { conn: undefined });
  await r.promise;
  assert.equal(built, false);
  assert.equal(await r.store.syncState(1), undefined);
});

test("a rate-limited job is requeued delayed to waitUntil under a distinct job id", async () => {
  const reset = new Date(now.getTime() + 10 * MIN);
  const r = run({ covers: async () => { throw new RateLimited(reset); }, pulls: empty.pulls });
  await r.promise;
  assert.deepEqual(r.added, [{ data: { repoId: 1, reconcile: false }, id: `discussion-sync-1-wait-${reset.getTime()}`, delay: 10 * MIN }]);
  assert.equal((await r.store.syncState(1))!.status, "waiting");
});

test("a no-access job is not requeued and does not mark a reconcile", async () => {
  const r = run({ covers: async () => { throw new NoAccess(); }, pulls: empty.pulls }, { reconcile: true });
  await r.promise;
  assert.deepEqual(r.added, []);
  assert.equal((await r.store.syncState(1))!.reconciledAt, null);
});

test("a failed job throws, stamps a fixed failed state, and sets no reconciledAt", async () => {
  const r = run({ covers: async () => { throw new Error("boom token=abc"); }, pulls: empty.pulls }, { reconcile: true });
  await assert.rejects(r.promise);
  const s = (await r.store.syncState(1))!;
  assert.deepEqual([s.status, s.error, s.reconciledAt, s.lastRunAt], ["failed", "sync failed", null, now]);
});

test("a source that cannot be built or does not cover the repository stamps lastRunAt with a fixed error", async () => {
  const store = fakeProvenanceStore({ "o/r": 1 });
  const base = { store, target, conn: gh, reconcile: false, requeue: async () => {}, now: () => now, ticketKeys: [] };
  await assert.rejects(runDiscussionJob({ ...base, makeSource: async () => { throw new Error("secret-token-text"); } }));
  assert.deepEqual([(await store.syncState(1))!.status, (await store.syncState(1))!.error, (await store.syncState(1))!.lastRunAt], ["failed", "sync failed", now]);
  await runDiscussionJob({ ...base, makeSource: async () => ({ covers: async () => false, pulls: empty.pulls }) });
  assert.deepEqual([(await store.syncState(1))!.status, (await store.syncState(1))!.error], ["failed", "not covered"]);
});

test("25 repositories that yield no source do not starve healthy never-run ones on the next tick", async () => {
  const names = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`o/r${i + 1}`, i + 1]));
  const store = fakeProvenanceStore(names);
  const plan = async () => planDiscussionSync(await Promise.all(Array.from({ length: 30 }, async (_, i) => repo(i + 1, { state: await store.syncState(i + 1) })), ), opts);
  const first = await plan();
  assert.equal(first.length, 20);
  for (const j of first) await runDiscussionJob({ store, target: { id: j.repoId, name: `o/r${j.repoId}`, dir: "/nope", head: null }, conn: gh, reconcile: false, makeSource: async () => { throw new Error("no token"); }, requeue: async () => {}, now: () => now, ticketKeys: [] }).catch(() => {});
  const second = (await plan()).map((j) => j.repoId);
  assert.deepEqual(second, [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]); // the 20 that failed went to the back
});

test("a running repository is skipped while recent and due again once its running state is over 2 hours stale", () => {
  const running = (lastRunAt: Date) => repo(1, { state: state({ status: "running", lastRunAt }) });
  assert.deepEqual(ids([running(ago(20 * MIN))]), []);
  assert.deepEqual(ids([running(ago(3 * HOUR))]), [1]);
});

test("a delayed job starting while a recent running state exists imports nothing", async () => {
  let built = false;
  const r = run({ covers: async () => { built = true; return true; }, pulls: empty.pulls }, { seed: state({ status: "running", lastRunAt: ago(20 * MIN) }) });
  await r.promise;
  assert.equal(built, false);
  const stale = run({ covers: async () => { built = true; return true; }, pulls: empty.pulls }, { seed: state({ status: "running", lastRunAt: ago(3 * HOUR) }) });
  await stale.promise.catch(() => {});
  assert.equal(built, true);
});

test("a reconcile that completes sets reconciledAt; a plain run leaves it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-sched-"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "D", GIT_AUTHOR_EMAIL: "d@example.test", GIT_COMMITTER_NAME: "D", GIT_COMMITTER_EMAIL: "d@example.test" };
  const git = (...a: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...a], { cwd: dir, env, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  git("add", ".");
  git("commit", "-qm", "initial");
  const real = { ...target, dir, head: git("rev-parse", "HEAD") };
  const seed = state({ reconciledAt: null });
  const rec = run(empty, { reconcile: true, seed, target: real });
  await rec.promise;
  assert.deepEqual((await rec.store.syncState(1))!.reconciledAt, now);
  const plain = run(empty, { seed, target: real });
  await plain.promise;
  assert.equal((await plain.store.syncState(1))!.reconciledAt, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Behaviour every ProvenanceStore adapter must show, P12 included (ADR 0001 section 7). Run against the in-memory fake in
// provenance.test.ts and against Postgres in packages/api/src/provenanceIsolation.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Discussion, Link, ProvenanceStore, SyncState } from "./provenance";

export const APP = "github.com/acme/app", LIB = "github.com/acme/lib", SECRET = "github.com/other/secret", NEVER = "github.com/acme/never";
export const CONTRACT_REPOS = [APP, LIB, SECRET, NEVER];
/** The Product under test: SECRET belongs to another Product. */
const SET = [APP, LIB, NEVER];

export type MakeStore = () => Promise<{ store: ProvenanceStore; id: (repo: string) => number }>;

const t = (s: string) => new Date(s);
export const pr = (number: number, o: Partial<Discussion> = {}): Discussion => ({
  kind: "PR", number, title: `PR ${number}`, body: "", state: "merged", authorLogin: "dev", createdAt: t("2025-01-01T00:00:00Z"),
  updatedAt: t(`2025-01-0${Math.min(9, (number % 9) + 1)}T00:00:00Z`), mergedAt: t("2025-01-02T00:00:00Z"), closedAt: t("2025-01-02T00:00:00Z"),
  mergeCommitSha: null, headRef: "feature", baseRef: "main", url: `https://example.test/pull/${number}`, labels: [], truncated: [], comments: [], files: [], ...o,
});
const ok = (): SyncState => ({ cursorUpdatedAt: t("2025-01-09T00:00:00Z"), lastRunAt: t("2025-02-01T00:00:00Z"), lastSuccessAt: t("2025-02-01T00:00:00Z"), headCommit: "abc", status: "ok", error: null, importedCount: 1, skippedCount: 0, access: "ok", waitUntil: null, reconciledAt: null });
const commit = (sha: string, n: number, o: Partial<Link> = {}): Link => ({ fromKind: "commit", fromRef: sha, toKind: "pr", toRef: String(n), toRepo: null, source: "merge-commit-sha", verified: true, ...o });
const ticket = (n: number, key: string): Link => ({ fromKind: "pr", fromRef: String(n), toKind: "ticket", toRef: key, toRepo: null, source: "ticket-pattern", verified: true });
const comment = (id: string, body: string, at: string) => ({ externalId: id, kind: "issue_comment" as const, authorLogin: "rev", body, state: null, path: null, line: null, createdAt: t(at), updatedAt: t(at) });

/** APP and LIB and SECRET imported; NEVER not. */
async function seeded(make: MakeStore) {
  const { store, id } = await make();
  for (const r of [APP, LIB, SECRET]) await store.saveSyncState(id(r), ok());
  return { store, id };
}

export function provenanceStoreContract(label: string, make: MakeStore, skip: boolean | string = false) {
  const it = (name: string, fn: () => Promise<void>) => test(`${label}: ${name}`, { skip }, fn);

  it("a discussion round-trips with its comments in time order and its files", async () => {
    const { store, id } = await seeded(make);
    const d = pr(7, {
      body: "Fixes it", labels: ["bug"], truncated: ["files"], mergeCommitSha: "a".repeat(40),
      comments: [comment("2", "second", "2025-01-03T00:00:00Z"), { ...comment("1", "LGTM", "2025-01-02T00:00:00Z"), kind: "review", state: "APPROVED", updatedAt: null }, { ...comment("3", "nit", "2025-01-04T00:00:00Z"), kind: "review_comment", path: "src/a.ts", line: 12 }],
      files: [{ path: "src/b.ts", additions: 1, deletions: 0 }, { path: "src/a.ts", additions: 3, deletions: 2 }],
    });
    await store.replaceDiscussion(id(APP), d, []);
    const got = await store.getDiscussion(SET, APP, 7);
    assert.ok(got && !("gap" in got));
    assert.deepEqual({ ...got, comments: undefined, files: undefined }, { ...d, comments: undefined, files: undefined });
    assert.deepEqual(got.comments.map((c) => [c.externalId, c.kind, c.state, c.path, c.line, c.updatedAt]), [["1", "review", "APPROVED", null, null, null], ["2", "issue_comment", null, null, null, t("2025-01-03T00:00:00Z")], ["3", "review_comment", null, "src/a.ts", 12, t("2025-01-04T00:00:00Z")]]);
    assert.deepEqual(got.files.map((f) => f.path), ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(await store.mergeCommits(id(APP)), [{ number: 7, mergeCommitSha: "a".repeat(40) }]);
  });

  it("replacing a discussion replaces its comments, files and links as a set (edited and deleted comments)", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(APP), pr(8, { comments: [comment("1", "first", "2025-01-02T00:00:00Z"), comment("2", "gone soon", "2025-01-03T00:00:00Z")], files: [{ path: "x", additions: 1, deletions: 1 }] }), [ticket(8, "TRUNK-1")]);
    await store.replaceDiscussion(id(APP), pr(8, { title: "PR 8 edited", comments: [comment("1", "first, edited", "2025-01-02T00:00:00Z")] }), [ticket(8, "TRUNK-2")]);
    const got = await store.getDiscussion(SET, APP, 8);
    assert.ok(got && !("gap" in got));
    assert.equal(got.title, "PR 8 edited");
    assert.deepEqual(got.comments.map((c) => [c.externalId, c.body]), [["1", "first, edited"]]);
    assert.deepEqual(got.files, []);
    assert.deepEqual((await store.links(SET, { kind: "pr", repo: APP, number: 8 })).links.map((l) => l.toRef), ["TRUNK-2"]);
    assert.deepEqual(await store.mergeCommits(id(APP)), [{ number: 8, mergeCommitSha: null }], "one row per (repository, number)");
  });

  it("the same number in two repositories is two discussions", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(APP), pr(5, { title: "app five" }), []);
    await store.replaceDiscussion(id(LIB), pr(5, { title: "lib five" }), []);
    assert.equal((await store.getDiscussion(SET, APP, 5) as Discussion).title, "app five");
    assert.equal((await store.getDiscussion(SET, LIB, 5) as Discussion).title, "lib five");
  });

  it("P12: a repository outside the set reads like a missing one; a never-imported one is a coverage gap", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(SECRET), pr(1, { title: "secret plan" }), [ticket(1, "TRUNK-9")]);
    assert.equal(await store.getDiscussion(SET, SECRET, 1), undefined);
    assert.equal(await store.getDiscussion(SET, "github.com/acme/missing", 1), undefined);
    assert.equal(await store.getDiscussion(SET, APP, 99), undefined, "imported repository, unknown number");
    assert.deepEqual(await store.getDiscussion(SET, NEVER, 1), { gap: "pull requests not ingested for github.com/acme/never" });
    assert.deepEqual(await store.links(SET, { kind: "pr", repo: SECRET, number: 1 }), { links: [], gaps: [] });
    assert.deepEqual(await store.links(SET, { kind: "ticket", key: "TRUNK-9" }), { links: [], gaps: [`pull requests not ingested for ${NEVER}`] });
    const s = await store.search(SET, { words: ["secret"] });
    assert.deepEqual([s.hits, s.gaps], [[], [`pull requests not ingested for ${NEVER}`]]);
    assert.deepEqual((await store.search(SET, { words: ["secret"], repo: SECRET })).hits, []);
  });

  it("P12: a link whose other end is in a repository outside the set is dropped", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(APP), pr(3), [
      { fromKind: "pr", fromRef: "3", toKind: "pr", toRef: "4", toRepo: SECRET, source: "body-ref", verified: true },
      { fromKind: "pr", fromRef: "3", toKind: "pr", toRef: "5", toRepo: LIB, source: "body-ref", verified: true },
      { fromKind: "pr", fromRef: "3", toKind: "pr", toRef: "6", toRepo: "github.com/elsewhere/unknown", source: "body-ref", verified: true },
    ]);
    // a link stored in SECRET pointing at APP must not surface either
    await store.replaceDiscussion(id(SECRET), pr(4), [{ fromKind: "pr", fromRef: "4", toKind: "pr", toRef: "3", toRepo: APP, source: "body-ref", verified: true }]);
    assert.deepEqual((await store.links(SET, { kind: "pr", repo: APP, number: 3 })).links.map((l) => [l.repo, l.toRepo, l.toRef]), [[APP, LIB, "5"]]);
    assert.deepEqual((await store.links([...SET, SECRET], { kind: "pr", repo: APP, number: 3 })).links.map((l) => [l.repo, l.toRef]).sort(), [[APP, "4"], [APP, "5"], [SECRET, "3"]]);
  });

  it("commit links: replaced as a set per repository; unverified ones hidden unless asked for", async () => {
    const { store, id } = await seeded(make);
    const sha = "b".repeat(40), bad = "c".repeat(40);
    await store.replaceCommitLinks(id(APP), [commit(sha, 1), commit(bad, 2, { verified: false }), commit("d".repeat(40), 3, { source: "squash-subject" })]);
    await store.replaceCommitLinks(id(APP), [commit(sha, 1), commit(bad, 2, { verified: false })]);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha })).links, [{ repo: APP, ...commit(sha, 1) }]);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: sha.toUpperCase() })).links.length, 1);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: bad })).links, []);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: bad }, { unverified: true })).links.map((l) => l.verified), [false]);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: "d".repeat(40) })).links, []);
    assert.deepEqual((await store.links(SET, { kind: "pr", repo: APP, number: 1 })).links.map((l) => [l.fromKind, l.fromRef]), [["commit", sha]]);
    await store.replaceCommitLinks(id(SECRET), [commit("e".repeat(40), 1)]);
    assert.deepEqual((await store.links(SET, { kind: "commit", sha: "e".repeat(40) })).links, []);
  });

  it("ticket lookups span the set and normalise the key's case", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(APP), pr(1), [ticket(1, "O3-12")]);
    await store.replaceDiscussion(id(LIB), pr(2), [ticket(2, "O3-12")]);
    assert.deepEqual((await store.links(SET, { kind: "ticket", key: "o3-12" })).links.map((l) => [l.repo, l.fromRef]), [[APP, "1"], [LIB, "2"]]);
  });

  it("search: words ANDed and case-insensitive over title, body, branch and comments; LIKE characters literal; bounded pages", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(APP), pr(1, { title: "Fix Login redirect", body: "100% broken", updatedAt: t("2025-03-01T00:00:00Z") }), []);
    await store.replaceDiscussion(id(APP), pr(2, { title: "Other", headRef: "login-cache", comments: [comment("1", "the REDIRECT loops", "2025-01-02T00:00:00Z")], updatedAt: t("2025-02-01T00:00:00Z") }), []);
    await store.replaceDiscussion(id(LIB), pr(3, { title: "login only", updatedAt: t("2025-04-01T00:00:00Z") }), []);
    const words = async (w: string[], o = {}) => (await store.search(SET, { words: w, ...o })).hits.map((h) => `${h.repo === APP ? "app" : "lib"}#${h.number}`);
    assert.deepEqual(await words(["login", "redirect"]), ["app#1", "app#2"]);
    assert.deepEqual(await words(["LOGIN"]), ["lib#3", "app#1", "app#2"]);
    assert.deepEqual(await words(["login"], { repo: LIB }), ["lib#3"]);
    assert.deepEqual(await words(["100%"]), ["app#1"]);
    assert.deepEqual(await words(["1_0"]), []);
    assert.deepEqual(await words(["%"]), ["app#1"]);
    assert.deepEqual(await words(["  "]), []);
    const page = await store.search(SET, { words: ["login"], limit: 2 });
    assert.deepEqual([page.hits.length, page.hasMore, page.timedOut], [2, true, false]);
    const next = await store.search(SET, { words: ["login"], limit: 2, offset: 2 });
    assert.deepEqual([next.hits.map((h) => h.number), next.hasMore], [[2], false]);
  });

  it("search: any=true matches a discussion with any word, keeps the repo filter and the scope", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(APP), pr(1, { title: "alpha", updatedAt: t("2025-03-01T00:00:00Z") }), []);
    await store.replaceDiscussion(id(APP), pr(2, { title: "beta", updatedAt: t("2025-02-01T00:00:00Z") }), []);
    await store.replaceDiscussion(id(LIB), pr(3, { title: "alpha beta", updatedAt: t("2025-04-01T00:00:00Z") }), []);
    const nums = async (o = {}) => (await store.search(SET, { words: ["alpha", "beta", "zzz"], any: true, ...o })).hits.map((h) => h.number);
    assert.deepEqual(await nums(), [3, 1, 2]);
    assert.deepEqual(await nums({ repo: APP }), [1, 2]);
    assert.deepEqual(await nums({ limit: 2 }), [3, 1]);
    assert.deepEqual((await store.search(SET, { words: ["alpha", "beta", "zzz"] })).hits, [], "default stays ANDed");
    // P12 and filters must bind tighter than the ORed words: an out-of-set repository and a wrong state never leak through a later word.
    await store.replaceDiscussion(id(SECRET), pr(4, { title: "beta outside", updatedAt: t("2025-05-01T00:00:00Z") }), []);
    await store.replaceDiscussion(id(APP), pr(5, { title: "beta open", state: "open", mergedAt: null, updatedAt: t("2025-01-01T00:00:00Z") }), []);
    assert.deepEqual(await nums(), [3, 1, 2, 5], "SECRET#4 never appears");
    assert.deepEqual(await nums({ state: "open" }), [5], "state filter applies to every ORed word");
    const r = await store.search(SET, { words: ["alpha", "beta"], any: true, state: "open" });
    assert.deepEqual([r.total, r.hits.length], [1, 1]);
  });

  it("search: kind, state and created-date filters; total counts every match, capped", async () => {
    const { store, id } = await seeded(make);
    await store.replaceDiscussion(id(APP), pr(1, { title: "widget one", state: "merged", createdAt: t("2025-01-01T00:00:00Z") }), []);
    await store.replaceDiscussion(id(APP), pr(2, { title: "widget two", state: "open", createdAt: t("2025-06-01T00:00:00Z") }), []);
    await store.replaceDiscussion(id(LIB), pr(3, { title: "widget three", kind: "ISSUE", state: "closed", createdAt: t("2025-03-01T00:00:00Z") }), []);
    const numbers = async (o = {}) => { const r = await store.search(SET, { words: ["widget"], ...o }); return [r.hits.map((h) => h.number).sort(), r.total, r.totalCapped]; };
    assert.deepEqual(await numbers(), [[1, 2, 3], 3, false]);
    assert.deepEqual(await numbers({ kind: "PR" }), [[1, 2], 2, false]);
    assert.deepEqual(await numbers({ kind: "ISSUE" }), [[3], 1, false]);
    assert.deepEqual(await numbers({ state: "open" }), [[2], 1, false]);
    assert.deepEqual(await numbers({ since: t("2025-03-01T00:00:00Z") }), [[2, 3], 2, false]);
    assert.deepEqual(await numbers({ until: t("2025-03-01T00:00:00Z") }), [[1, 3], 2, false]);
    assert.deepEqual(await numbers({ limit: 1 }), [[3], 3, false], "total is the match count, not the page size");
    assert.deepEqual(await numbers({ words: ["nothing"] }), [[], 0, false]);
  });

  it("sync state round-trips", async () => {
    const { store, id } = await make();
    assert.equal(await store.syncState(id(APP)), undefined);
    const s: SyncState = { ...ok(), status: "failed", error: "import failed", lastSuccessAt: null };
    await store.saveSyncState(id(APP), s);
    assert.deepEqual(await store.syncState(id(APP)), s);
  });

  it("sync state round-trips waiting and no-access with their times", async () => {
    const { store, id } = await make();
    const w: SyncState = { ...ok(), status: "waiting", access: "unknown", waitUntil: t("2030-01-01T00:00:00Z"), reconciledAt: t("2025-01-05T00:00:00Z") };
    await store.saveSyncState(id(APP), w);
    assert.deepEqual(await store.syncState(id(APP)), w);
    const n: SyncState = { ...w, status: "ok", access: "no-access", waitUntil: null };
    await store.saveSyncState(id(APP), n);
    assert.deepEqual(await store.syncState(id(APP)), n);
  });

  it("freshness lists the sync rows of the named repositories only, newest facts as stored", async () => {
    const { store, id } = await make();
    await store.saveSyncState(id(APP), ok());
    await store.saveSyncState(id(LIB), { ...ok(), status: "failed", access: "no-access", lastSuccessAt: null });
    await store.saveSyncState(id(SECRET), ok());
    const got = await store.freshness([LIB, APP, NEVER, "github.com/acme/unknown"]);
    assert.deepEqual(got, {
      rows: [
        { repo: APP, lastSuccessAt: t("2025-02-01T00:00:00Z"), status: "ok", access: "ok" },
        { repo: LIB, lastSuccessAt: null, status: "failed", access: "no-access" },
      ],
      truncated: false,
    }, "NEVER has no row, SECRET was not named");
    assert.deepEqual(await store.freshness([]), { rows: [], truncated: false });
  });
}

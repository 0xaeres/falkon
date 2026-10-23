import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSnapshot, fetchSnapshot, goldPrs, verifySnapshot, type Deps, type Repo } from "./discussions.js";

const PIN = "2024-06-01T00:00:00Z";
const user = (login: string) => ({ login });
const page = (nodes: unknown[], hasNextPage = false) => ({ pageInfo: { hasNextPage, endCursor: "c" }, nodes });
const pr = (number: number, createdAt: string, extra: Record<string, unknown> = {}) => ({
  number, title: `PR ${number}`, body: "body", state: "MERGED", merged: true, mergedAt: createdAt, createdAt, updatedAt: createdAt, closedAt: createdAt,
  author: user("alice"), headRefName: "h", baseRefName: "main", mergeCommit: { oid: `m${number}` }, url: `https://x/${number}`, labels: { nodes: [{ name: "bug" }] },
  comments: page([]), reviews: page([]), reviewThreads: page([]), files: page([{ path: "a.ts", additions: 1, deletions: 0 }]), ...extra,
});
const live = [
  pr(1, "2024-05-01T00:00:00Z", {
    body: "ping bob@example.com with ghp_abcdef123456",
    comments: page([
      { databaseId: 11, author: user("bob"), body: "before", createdAt: "2024-05-02T00:00:00Z", updatedAt: "2024-05-02T00:00:00Z" },
      { databaseId: 12, author: user("bob"), body: "after", createdAt: "2024-07-02T00:00:00Z", updatedAt: "2024-07-02T00:00:00Z" },
    ], true),
    reviews: page([{ databaseId: 21, author: null, state: "APPROVED", body: "ok", submittedAt: "2024-05-03T00:00:00Z" }, { databaseId: 22, author: user("c"), state: "COMMENTED", body: "late", submittedAt: "2024-08-01T00:00:00Z" }]),
    reviewThreads: page([{ comments: page([{ databaseId: 31, author: user("c"), body: "r", path: "i18n/uz@Latn.json", line: null, originalLine: 7, createdAt: "2024-05-04T00:00:00Z", updatedAt: "2024-05-04T00:00:00Z" }, { databaseId: 32, author: user("c"), body: "late", path: "a.ts", line: 8, createdAt: "2024-09-04T00:00:00Z", updatedAt: "2024-09-04T00:00:00Z" }]) }]),
  }),
  pr(2, "2024-05-20T00:00:00Z", { mergedAt: "2024-07-01T00:00:00Z", closedAt: "2024-07-01T00:00:00Z", updatedAt: "2024-07-01T00:00:00Z" }),
  pr(3, "2024-07-05T00:00:00Z"),
  pr(4, "2022-01-01T00:00:00Z"),
  pr(5, "2023-01-01T00:00:00Z", { files: page([{ path: "z", additions: 1, deletions: 1 }], true) }),
];
// Pages after the first: comments of pull request 1 have one more; files of pull request 5 never end.
const second: Record<string, any> = { "1:comments": page([{ databaseId: 13, author: user("d"), body: "second page\n@org.codehaus.jackson.Json", createdAt: "2024-05-05T00:00:00Z", updatedAt: "2024-05-05T00:00:00Z" }]) };

function fakeGh(opts: { fail?: (q: string) => boolean; rate?: { remaining: number; resetAt: string } } = {}) {
  const calls: string[] = [];
  const gh = (_args: string[], input: string) => {
    const { query, variables } = JSON.parse(input);
    calls.push(query.includes("pullRequests(") ? "list" : query.includes("fragment F") ? "batch" : "more");
    if (opts.fail?.(query)) throw new Error("boom");
    const rateLimit = { cost: 1, remaining: opts.rate?.remaining ?? 4000, resetAt: opts.rate?.resetAt ?? "2024-01-01T00:00:00Z" };
    if (query.startsWith("query{")) return JSON.stringify({ data: { rateLimit } });
    if (query.includes("pullRequests(")) {
      const sorted = [...live].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), at = variables.after ? Number(variables.after) : 0;
      const nodes = sorted.slice(at, at + 2).map(({ number, createdAt, updatedAt }) => ({ number, createdAt, updatedAt }));
      return JSON.stringify({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: at + 2 < sorted.length, endCursor: String(at + 2) }, nodes } }, rateLimit } });
    }
    if (query.includes("fragment F")) {
      const repository = Object.fromEntries([...query.matchAll(/p(\d+):pullRequest/g)].map((m) => [`p${m[1]}`, live.find((p) => p.number === Number(m[1]))]));
      return JSON.stringify({ data: { repository, rateLimit } });
    }
    const field = /\{(comments|reviews|reviewThreads|files)\(/.exec(query)![1]!;
    const more = field === "files" ? page([{ path: "n", additions: 0, deletions: 0 }], true) : second[`${variables.n}:${field}`];
    return JSON.stringify({ data: { repository: { pullRequest: { [field]: more } }, rateLimit } });
  };
  return { gh, calls };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "eval-disc-")), clone = join(root, "clone");
  execFileSync("git", ["init", "-q", clone]);
  const env = { ...process.env, GIT_COMMITTER_DATE: PIN, GIT_AUTHOR_DATE: PIN };
  writeFileSync(join(clone, "f"), "1");
  execFileSync("git", ["-C", clone, "add", "."]);
  execFileSync("git", ["-C", clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one"], { env });
  const commit = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const repo: Repo = { name: "r", checkout: "clone", commit };
  const logs: string[] = [], sleeps: number[] = [];
  const deps = (gh: Deps["gh"]): Deps => ({ gh, sleep: async (ms) => { sleeps.push(ms); }, now: () => new Date("2025-01-01T00:00:00Z"), log: (l) => logs.push(l) });
  return { root, repo, deps, logs, sleeps, manifest: join(root, "manifest.json"), file: (n: number) => JSON.parse(readFileSync(join(root, "github-snapshot/r/pulls", `${n}.json`), "utf8")) };
}

test("cut rule: window, later activity dropped, later merge shown as open, logins only, secrets scrubbed", async () => {
  const fx = fixture();
  try {
    const out = await fetchSnapshot(fx.root, [fx.repo], fx.deps(fakeGh().gh), fx.manifest);
    assert.deepEqual(readdirSync(join(fx.root, "github-snapshot/r/pulls")).sort(), ["1.json", "2.json", "5.json"]);
    const one = fx.file(1);
    assert.deepEqual(one.comments.map((c: any) => c.id), [11, 13], "after-pin comment dropped, second page followed");
    assert.deepEqual(one.reviews.map((r: any) => r.id), [21]);
    assert.deepEqual(one.reviewComments.map((c: any) => [c.id, c.line]), [[31, 7]]);
    assert.equal(one.reviews[0].authorLogin, null);
    assert.equal(one.body, "ping [email removed] with [token removed]");
    assert.equal(one.mergeCommitSha, "m1");
    const two = fx.file(2);
    assert.deepEqual([two.state, two.merged, two.mergedAt, two.closedAt, two.mergeCommitSha, two.updatedAt], ["open", false, null, null, null, PIN]);
    assert.deepEqual(JSON.parse(readFileSync(join(fx.root, "github-snapshot/r/_meta.json"), "utf8")), { repo: "r", owner: "openmrs", pinSha: fx.repo.commit, pinDate: PIN, windowStart: "2022-06-01T00:00:00Z", fetchedAt: "2025-01-01T00:00:00Z", pullRequestCount: 3 });
    assert.match(out, /API points used: \d+/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("a connection still open after the page cap is flagged truncated", async () => {
  const fx = fixture();
  try {
    await fetchSnapshot(fx.root, [fx.repo], fx.deps(fakeGh().gh), fx.manifest);
    assert.deepEqual(fx.file(5).truncated, { files: true });
    assert.deepEqual(fx.file(1).truncated, {});
    assert.equal(fx.file(5).files.length, 5);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("a re-run fetches no full pull request and writes nothing new; a missing file is refetched alone", async () => {
  const fx = fixture();
  try {
    await fetchSnapshot(fx.root, [fx.repo], fx.deps(fakeGh().gh), fx.manifest);
    const before = readFileSync(fx.manifest, "utf8");
    const again = fakeGh();
    const out = await fetchSnapshot(fx.root, [fx.repo], fx.deps(again.gh), fx.manifest);
    assert.ok(!again.calls.includes("batch"));
    assert.match(out, /0 fetched, 0 files written/);
    assert.equal(readFileSync(fx.manifest, "utf8"), before);
    rmSync(join(fx.root, "github-snapshot/r/pulls/2.json"));
    const resume = fakeGh();
    assert.match(await fetchSnapshot(fx.root, [fx.repo], fx.deps(resume.gh), fx.manifest), /1 fetched, 1 files written/);
    assert.equal(readFileSync(fx.manifest, "utf8"), before);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("a failing batch is split and retried; a low rate limit sleeps until reset", async () => {
  const fx = fixture();
  try {
    const g = fakeGh({ fail: (q) => q.includes("fragment F") && /p1:.*p2:|p2:.*p5:/.test(q), rate: { remaining: 10, resetAt: "2025-01-01T00:01:00Z" } });
    const out = await fetchSnapshot(fx.root, [fx.repo], fx.deps(g.gh), fx.manifest);
    assert.match(out, /3 pull requests/);
    assert.match(out, /remaining 10, waited 62s/);
    assert.ok(fx.sleeps.includes(62000));
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("verify matches the manifest and fails after a file changes", async () => {
  const fx = fixture();
  try {
    await fetchSnapshot(fx.root, [fx.repo], fx.deps(fakeGh().gh), fx.manifest);
    assert.match(verifySnapshot(fx.root, [fx.repo], fx.manifest), /3 pull requests/);
    writeFileSync(join(fx.root, "github-snapshot/r/pulls/1.json"), "{}\n");
    assert.throws(() => verifySnapshot(fx.root, [fx.repo], fx.manifest), /differs/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("no token or email survives anywhere in the snapshot, and the check catches one that does", async () => {
  const fx = fixture();
  try {
    await fetchSnapshot(fx.root, [fx.repo], fx.deps(fakeGh().gh), fx.manifest);
    const all = readdirSync(join(fx.root, "github-snapshot/r/pulls")).map((f) => readFileSync(join(fx.root, "github-snapshot/r/pulls", f), "utf8")).join("");
    assert.ok(!/ghp_|github_pat_|gho_|@example\.com/.test(all));
    const gold = [{ repo: "r", commit: "m1", pr: 1, id: "q" }];
    assert.throws(() => checkSnapshot(fx.root, [fx.repo], gold), /mergeCommitSha m1 differs|not reachable/ );
    writeFileSync(join(fx.root, "github-snapshot/r/pulls/5.json"), JSON.stringify({ merged: true, body: "x@y.org ghp_zzz" }));
    assert.throws(() => checkSnapshot(fx.root, [fx.repo], []), (e: Error) => /token-like/.test(e.message) && /email/.test(e.message));
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("check passes a merged gold pull request whose commit is reachable from the pin, and reports a missing one", async () => {
  const fx = fixture();
  try {
    live[0]!.mergeCommit.oid = fx.repo.commit;
    await fetchSnapshot(fx.root, [fx.repo], fx.deps(fakeGh().gh), fx.manifest);
    assert.match(checkSnapshot(fx.root, [fx.repo], [{ repo: "r", commit: fx.repo.commit, pr: 1, id: "q" }]), /checked: 1;.*violations: 0/);
    assert.throws(() => checkSnapshot(fx.root, [fx.repo], [{ repo: "r", commit: fx.repo.commit, pr: 99, id: "q" }]), /missing from the snapshot/);
  } finally { live[0]!.mergeCommit.oid = "m1"; rmSync(fx.root, { recursive: true, force: true }); }
});

test("a pull request whose merge commit is the pin counts as merged although mergedAt is after the pin", async () => {
  const fx = fixture();
  try {
    live[1]!.mergeCommit.oid = fx.repo.commit;
    await fetchSnapshot(fx.root, [fx.repo], fx.deps(fakeGh().gh), fx.manifest);
    assert.deepEqual([fx.file(2).merged, fx.file(2).state, fx.file(2).mergeCommitSha], [true, "closed", fx.repo.commit]);
  } finally { live[1]!.mergeCommit.oid = "m2"; rmSync(fx.root, { recursive: true, force: true }); }
});

test("goldPrs lists change items with a pull request and skips ticket items", () => {
  assert.deepEqual(goldPrs({ questions: [{ id: "q", required: [{ repo: "r", commit: "c", pr: 3 }, { ticket: "T-1" }] }] }), [{ repo: "r", commit: "c", pr: 3, id: "q" }]);
});

// The live GitHub discussion source over the S51 recorded responses through a fake transport (no network, no token).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NoAccess, RateLimited, type Discussion } from "@falkon/shared";
import { fakeProvenanceStore } from "../../shared/src/provenance.fake";
import { importDiscussions, mapSnapshotPull } from "./discussions";
import { githubSource, githubTransport, type GithubTransport } from "./githubDiscussions";
import { FRAGMENT, firstPages, shapePull } from "./githubQuery";

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/github", f), "utf8"));
const DS = "openmrs/openmrs-module-dataentrystatistics", KC = "openmrs/openmrs-contrib-keycloak-smart-auth", CORE = "openmrs/openmrs-core";
const NODES: Record<string, Record<string, any>> = {
  [DS]: fx("dataentrystatistics-pulls.json").data.repository,
  [KC]: fx("keycloak-smart-auth-pulls.json").data.repository,
  [CORE]: fx("openmrs-core-pulls.json").data.repository,
};
const RATES = fx("rate-limit.json");
const HEADERS: Record<string, string> = RATES.rest[0].rateLimitHeaders;
const GQL_RATE = { limit: 5000, ...RATES.graphql[0].rateLimit };
const NOW = () => new Date("2026-10-24T00:00:00Z");
const LONG = 1000; // months: every fixture pull request is inside the window

const item = (repo: string, number: number, updated_at: string) => ({ number, updated_at, pull_request: {}, repository_url: `https://api.github.com/repos/${repo}` });
const itemsOf = (repo: string) => Object.values(NODES[repo]!).map((n) => item(repo, n.number, n.updatedAt));
const nodesOf = (repo: string) => Object.fromEntries(Object.values(NODES[repo]!).map((n) => [n.number, n]));
/** A pull request node like dataentrystatistics #3 with another number and updated time. */
const synth = (number: number, updatedAt: string) => ({ ...NODES[DS]!.p3, number, updatedAt });

type Call = { kind: "get" | "graphql"; path?: string; params?: any; variables?: any; nums?: number[] };
function fake(o: {
  items?: any[]; nodes?: Record<number, any>; probe?: () => unknown; headers?: Record<string, string>; rateLimit?: any;
  get?: (path: string, params: any, n: number) => unknown; graphql?: () => any; onList?: (n: number, items: any[]) => void;
} = {}) {
  const calls: Call[] = [];
  let lists = 0;
  const transport: GithubTransport = {
    async get(p, params: any) {
      calls.push({ kind: "get", path: p, params });
      const custom = o.get?.(p, params, calls.length);
      if (custom) return custom as any;
      if (p.endsWith("/issues/comments")) return { data: [], headers: o.headers ?? HEADERS };
      if (p.endsWith("/pulls")) return { data: o.probe ? o.probe() : [], headers: o.headers ?? HEADERS };
      const items = o.items ?? [];
      o.onList?.(lists++, items);
      const page = [...items].filter((i) => i.updated_at >= params.since).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      return { data: page.slice((params.page - 1) * params.per_page, params.page * params.per_page), headers: o.headers ?? HEADERS };
    },
    async graphql(query, variables) {
      const nums = [...query.matchAll(/p(\d+):pullRequest/g)].map((m) => Number(m[1]));
      calls.push({ kind: "graphql", variables, nums });
      if (o.graphql) return o.graphql();
      const rateLimit = typeof o.rateLimit === "function" ? o.rateLimit(calls.filter((c) => c.kind === "graphql").length) : o.rateLimit ?? GQL_RATE;
      return { data: { repository: Object.fromEntries(nums.map((n) => [`p${n}`, o.nodes?.[n] ?? null])), rateLimit } };
    },
  };
  return { transport, calls, lists: () => calls.filter((c) => c.kind === "get" && c.path!.endsWith("/issues")) };
}
const collect = async (it: AsyncIterable<Discussion | { skipped: string }>) => { const out: (Discussion | { skipped: string })[] = []; for await (const d of it) out.push(d); return out; };
const prs = (out: (Discussion | { skipped: string })[]) => out.filter((d): d is Discussion => "number" in d);
const quiet = async <T>(fn: () => Promise<T>) => {
  const lines: string[] = [], saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { return { value: await fn().catch((e) => e), lines }; } finally { [console.log, console.warn, console.error] = saved; }
};

test("parity: each fixture pull request maps exactly as mapSnapshotPull maps its snapshot shape, ascending by updatedAt", async () => {
  for (const repo of [DS, KC, CORE]) {
    const f = fake({ items: itemsOf(repo), nodes: nodesOf(repo) });
    const out = await collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${repo}`, null));
    const want = Object.values(NODES[repo]!).map((n) => mapSnapshotPull(shapePull(n, firstPages(n), "9999-12-31T00:00:00Z"))).sort((a, b) => +a.updatedAt - +b.updatedAt);
    assert.deepEqual(out, want, repo);
    assert.ok(want.length >= 2);
  }
});

test("101+ comments: the first page is kept and truncated is set; a deleted author stays null", async () => {
  const f = fake({ items: itemsOf(CORE), nodes: nodesOf(CORE) });
  const out = prs(await collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${CORE}`, null)));
  const big = out.find((d) => d.number === 2712)!, ghost = out.find((d) => d.number === 294)!;
  assert.ok(big.truncated.includes("comments"));
  assert.equal(big.comments.filter((c) => c.kind === "issue_comment").length, 100);
  assert.equal(ghost.authorLogin, null);
  assert.equal(f.calls.filter((c) => c.kind === "graphql").length, 1, "no extra page requests");
});

test("logins only: every user selection of the query asks for login and nothing else", () => {
  const users = [...FRAGMENT.matchAll(/author\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(users.length, 4, "pull request, comment, review and review comment authors");
  assert.deepEqual(new Set(users), new Set(["login"]));
  assert.doesNotMatch(FRAGMENT, /email|avatar|headRefOid|\bname\b(?!\})/);
});

test("backfill: the first run lists from the window start (24 months) and never details an older pull request", async () => {
  const f = fake({ items: itemsOf(KC), nodes: nodesOf(KC) });
  const out = prs(await collect(githubSource({ transport: f.transport, now: NOW }).pulls(`github.com/${KC}`, null)));
  assert.deepEqual(f.lists().map((c) => c.params), [{ state: "all", sort: "updated", direction: "asc", since: "2024-10-24T00:00:00Z", per_page: 100, page: 1 }]);
  assert.deepEqual(out.map((d) => d.number), [21]);
  assert.deepEqual(f.calls.filter((c) => c.kind === "graphql").flatMap((c) => c.nums), [21]);
});

test("a second run lists only since the stored cursor; with the local clock behind, since is still the cursor", async () => {
  for (const now of [NOW, () => new Date("2019-01-01T00:00:00Z")]) {
    const f = fake({ items: itemsOf(KC), nodes: nodesOf(KC) });
    const out = prs(await collect(githubSource({ transport: f.transport, now }).pulls(`github.com/${KC}`, new Date("2020-07-23T19:42:44Z"))));
    assert.equal(f.lists()[0]!.params.since, "2020-07-23T19:42:44Z");
    assert.deepEqual(out.map((d) => d.number), [3, 14, 21], "at or after the cursor");
  }
});

test("reconcile ignores a recent cursor and re-reads the last 30 days; an older cursor is kept", async () => {
  const since = async (cursor: Date) => {
    const f = fake();
    await collect(githubSource({ transport: f.transport, reconcile: true, now: NOW }).pulls(`github.com/${KC}`, cursor));
    return f.lists()[0]!.params.since;
  };
  assert.equal(await since(new Date("2026-10-20T00:00:00Z")), "2026-09-24T00:00:00Z");
  assert.equal(await since(new Date("2026-01-01T00:00:00Z")), "2026-01-01T00:00:00Z");
});

test("discovery keeps only listing items with a pull_request key, detailed in batches of at most 10", async () => {
  const items = fx("querystore-issues.json");
  const want = items.filter((i: any) => "pull_request" in i).map((i: any) => i.number);
  assert.equal(want.length, 33);
  const f = fake({ items });
  const out = await collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls("github.com/openmrs/openmrs-module-querystore", null));
  const batches = f.calls.filter((c) => c.kind === "graphql");
  assert.deepEqual(batches.flatMap((c) => c.nums).sort((a, b) => a! - b!), [...want].sort((a, b) => a - b));
  assert.ok(batches.every((c) => c.nums!.length <= 10));
  assert.equal(out.filter((d) => "skipped" in d).length, 33, "a pull request GraphQL returns null for is skipped, not dropped");
});

test("an item that moves to a later page between requests is still read (keyset pages on updated_at)", async () => {
  const items = Array.from({ length: 150 }, (_, i) => item(DS, i + 1, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString().replace(".000Z", "Z")));
  const nodes = Object.fromEntries(items.map((i) => [i.number, synth(i.number, i.updated_at)]));
  // after the first page is served, #5 is edited (moves to the end) and every later item shifts one place left
  const f = fake({ items, nodes, onList: (n, all) => { if (n === 1) { all.find((i) => i.number === 5)!.updated_at = "2026-06-01T00:00:00Z"; nodes[5] = synth(5, "2026-06-01T00:00:00Z"); } } });
  const out = prs(await collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${DS}`, null)));
  assert.deepEqual(new Set(out.map((d) => d.number)), new Set(items.map((i) => i.number)));
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1]!.updatedAt <= out[i]!.updatedAt, "ascending");
});

test("more than a page of items sharing one updated_at still terminates and reads them all", async () => {
  const items = Array.from({ length: 120 }, (_, i) => item(DS, i + 1, "2026-02-02T00:00:00Z"));
  const nodes = Object.fromEntries(items.map((i) => [i.number, synth(i.number, i.updated_at)]));
  const f = fake({ items, nodes });
  const out = prs(await collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${DS}`, null)));
  assert.equal(new Set(out.map((d) => d.number)).size, 120);
  assert.deepEqual(f.lists().map((c) => [c.params.since, c.params.page]), [["1943-06-24T00:00:00Z", 1], ["2026-02-02T00:00:00Z", 1], ["2026-02-02T00:00:00Z", 2]]);
});

test("permission probe: GET pulls?per_page=1; 403 and 404 throw NoAccess; an empty repository is covered and yields nothing", async () => {
  for (const status of [403, 404]) {
    const f = fake({ get: () => { throw Object.assign(new Error("Resource not accessible by token"), { status }); } });
    const { value } = await quiet(() => githubSource({ transport: f.transport, now: NOW }).covers(`github.com/${DS}`));
    assert.ok(value instanceof NoAccess, String(status));
    assert.deepEqual(f.calls.map((c) => [c.path, c.params]), [[`/repos/${DS}/pulls`, { per_page: 1 }]], "probed once, no retry");
  }
  const f = fake({ probe: () => fx("dataentrystatistics-probe.json") });
  const src = githubSource({ transport: f.transport, now: NOW });
  assert.equal(await src.covers(`github.com/${DS}`), true);
  assert.deepEqual(await collect(src.pulls(`github.com/${DS}`, null)), []);
  assert.equal(f.calls.filter((c) => c.kind === "graphql").length, 0);
});

test("9% REST budget left: RateLimited with GitHub's reset time before any further request", async () => {
  const f = fake({ items: itemsOf(DS), nodes: nodesOf(DS), headers: { ...HEADERS, "x-ratelimit-remaining": "450" } });
  const src = githubSource({ transport: f.transport, now: NOW });
  const low = (e: unknown) => e instanceof RateLimited && e.resetAt.getTime() === Number(HEADERS["x-ratelimit-reset"]) * 1000;
  await assert.rejects(src.covers(`github.com/${DS}`), low, "the second probe is not sent");
  await assert.rejects(collect(src.pulls(`github.com/${DS}`, null)), low);
  assert.equal(f.calls.length, 1);
});

test("9% GraphQL budget left: the batch read is kept, and the next request is not sent", async () => {
  const f = fake({ items: itemsOf(DS), nodes: nodesOf(DS), rateLimit: { ...GQL_RATE, remaining: 450 } });
  const src = githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW });
  assert.equal(prs(await collect(src.pulls(`github.com/${DS}`, null))).length, 3);
  const before = f.calls.length;
  await assert.rejects(src.covers(`github.com/${KC}`), (e) => e instanceof RateLimited && e.resetAt.toISOString() === "2026-10-24T03:32:49.000Z");
  assert.equal(f.calls.length, before);
  // after the reset time the budget is back
  const later = githubSource({ transport: f.transport, now: () => new Date("2026-10-24T04:00:00Z") });
  assert.equal(await later.covers(`github.com/${KC}`), true);
});

test("a 5xx retries as fetchWithRetry does, then fails with a fixed error that carries no GitHub text", async () => {
  const f = fake({ get: (p) => { if (p.endsWith("/issues")) throw Object.assign(new Error("server token trouble"), { status: 502, response: { headers: { "x-ratelimit-reset": "0" } } }); } });
  const { value, lines } = await quiet(() => collect(githubSource({ transport: f.transport, now: NOW }).pulls(`github.com/${DS}`, null)));
  assert.equal(f.lists().length, 3);
  assert.ok(value instanceof Error);
  assert.equal(value.message, "GitHub request failed");
  assert.equal(value.cause, undefined);
  assert.ok(!lines.join("\n").includes("token trouble"));
});

test("a GraphQL error body naming a token is neither kept nor logged; partial data with errors is still used", async () => {
  const errors = [{ type: "FORBIDDEN", message: "token ghp_[token removed] cannot read this" }];
  const f = fake({ items: itemsOf(DS), graphql: () => ({ errors }) });
  const { value, lines } = await quiet(() => collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${DS}`, null)));
  assert.ok(value instanceof Error && value.message === "GitHub request failed" && value.cause === undefined);
  assert.ok(!JSON.stringify(value).includes("token") && !String(value.stack).includes("cannot read") && !lines.join("\n").includes("token"));
  const p = fake({ items: itemsOf(DS), graphql: () => ({ errors, data: { repository: NODES[DS], rateLimit: GQL_RATE } }) });
  assert.equal(prs(await collect(githubSource({ transport: p.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${DS}`, null))).length, 3);
});

test("a force-pushed pull request: no head sha reaches the Discussion", async () => {
  const head = "1".repeat(40);
  const nodes = { 10: { ...NODES[DS]!.p10, headRefOid: head, headRef: { target: { oid: head } } } };
  const f = fake({ items: [item(DS, 10, NODES[DS]!.p10.updatedAt)], nodes });
  const [d] = prs(await collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${DS}`, null)));
  assert.ok(d && !JSON.stringify(d).includes(head));
});

test("a renamed repository: detail is asked under the name the listing reports", async () => {
  const f = fake({ items: itemsOf(DS).map((i) => ({ ...i, repository_url: "https://api.github.com/repos/openmrs/renamed-stats" })), nodes: nodesOf(DS) });
  assert.equal(prs(await collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${DS}`, null))).length, 3);
  assert.equal(f.lists()[0]!.path, `/repos/${DS}/issues`);
  assert.deepEqual(f.calls.find((c) => c.kind === "graphql")!.variables, { owner: "openmrs", name: "renamed-stats" });
});

test("the Octokit transport: a missing token is a fixed error before any request; an enterprise url is used for REST and GraphQL", async () => {
  const saved = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (u: any) => {
    urls.push(String(u));
    const body = String(u).endsWith("/graphql") ? { data: { repository: {}, rateLimit: GQL_RATE } } : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...HEADERS } });
  }) as typeof fetch;
  try {
    await assert.rejects(githubTransport({}), { message: "GitHub token missing" });
    assert.deepEqual(urls, []);
    process.env.FALKON_TEST_GH_TOKEN = "test-value";
    const t = await githubTransport({ token: { env: "FALKON_TEST_GH_TOKEN" }, url: "https://ghe.example.test" });
    const src = githubSource({ transport: t, now: NOW });
    assert.equal(await src.covers(`ghe.example.test/${DS}`), true);
    await t.graphql("query{rateLimit{remaining}}", {});
    assert.deepEqual(urls, [`https://ghe.example.test/api/v3/repos/${DS}/pulls?per_page=1`, `https://ghe.example.test/api/v3/repos/${DS}/issues/comments?per_page=1`, "https://ghe.example.test/api/graphql"]);
  } finally {
    globalThis.fetch = saved;
    delete process.env.FALKON_TEST_GH_TOKEN;
  }
});

const forbidden = (headers: Record<string, string>, message = "Resource not accessible by personal access token") =>
  Object.assign(new Error(message), { status: 403, response: { headers, data: { message } } });

test("a 403 is NoAccess only without a rate signal: remaining 0 is RateLimited, retry-after or abuse text is the fixed error; never retried", async () => {
  const cases: [Error, (e: unknown) => boolean][] = [
    [forbidden({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1792811421" }, "API rate limit exceeded"), (e) => e instanceof RateLimited && e.resetAt.getTime() === 1792811421_000],
    [forbidden({ "retry-after": "60" }, "You have exceeded a secondary rate limit"), (e) => e instanceof Error && e.message === "GitHub request failed"],
    [forbidden({}, "You have triggered an abuse detection mechanism"), (e) => e instanceof Error && e.message === "GitHub request failed"],
    [forbidden({ "x-ratelimit-remaining": "4000", "x-ratelimit-reset": "1792811421" }), (e) => e instanceof NoAccess],
  ];
  for (const [err, ok] of cases) {
    const f = fake({ get: (p) => { if (p.endsWith("/issues")) throw err; } });
    const started = Date.now();
    const { value, lines } = await quiet(() => collect(githubSource({ transport: f.transport, now: NOW }).pulls(`github.com/${DS}`, null)));
    assert.ok(ok(value), err.message);
    assert.equal(f.lists().length, 1, "no retry");
    assert.ok(Date.now() - started < 1000, "no sleep until the reset");
    assert.ok(!lines.join("\n").includes(err.message));
  }
});

test("the probe also reads conversation comments (Issues: Read): a 403 there is NoAccess after exactly 2 requests, no retry", async () => {
  const f = fake({ get: (p) => { if (p.endsWith("/issues/comments")) throw forbidden({ "x-ratelimit-reset": "9999999999" }); } });
  const started = Date.now();
  await assert.rejects(githubSource({ transport: f.transport, now: NOW }).covers(`github.com/${DS}`), (e) => e instanceof NoAccess);
  assert.deepEqual(f.calls.map((c) => [c.path, c.params]), [[`/repos/${DS}/pulls`, { per_page: 1 }], [`/repos/${DS}/issues/comments`, { per_page: 1 }]]);
  assert.ok(Date.now() - started < 1000);
});

test("the cursor follows the listing's order: a detail newer than its listing time cannot carry the cursor past unread items", async () => {
  const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString().replace(".000Z", "Z");
  const items = Array.from({ length: 12 }, (_, i) => item(DS, i + 1, t(i))); // batch 1: #1 to #10; batch 2: #11 (B), #12 (C)
  const nodes: Record<number, any> = Object.fromEntries(items.map((i) => [i.number, synth(i.number, i.updated_at)]));
  nodes[1] = synth(1, "2026-09-01T00:00:00Z"); // A was edited after the listing was read
  const low = { ...GQL_RATE, remaining: 450, resetAt: "2026-10-24T03:32:49Z" };
  const store = fakeProvenanceStore({ [`github.com/${DS}`]: 1 });
  const target = { id: 1, name: `github.com/${DS}`, dir: "/nonexistent", head: "a".repeat(40) };
  const first = fake({ items, nodes, rateLimit: (n: number) => (n === 1 ? low : GQL_RATE) });
  const r = await importDiscussions(store, githubSource({ transport: first.transport, backfillMonths: LONG, now: NOW }), target, [], NOW);
  assert.equal(r?.imported, 10);
  const state = (await store.syncState(1))!;
  assert.equal(state.status, "waiting");
  assert.ok(state.cursorUpdatedAt! < new Date(t(10)), `cursor ${state.cursorUpdatedAt?.toISOString()} must stay before B`);
  const second = fake({ items, nodes });
  await collect(githubSource({ transport: second.transport, backfillMonths: LONG, now: NOW }).pulls(target.name, state.cursorUpdatedAt));
  const read = second.calls.filter((c) => c.kind === "graphql").flatMap((c) => c.nums);
  assert.ok(read.includes(11) && read.includes(12), "B and C are read on the next run");
});

test("a GraphQL RATE_LIMITED error with no data is RateLimited, with the block's reset time or a minute from now", async () => {
  const errors = [{ type: "RATE_LIMITED", message: "API rate limit exceeded for token" }];
  for (const [data, reset] of [[{ rateLimit: { ...GQL_RATE, remaining: 0 } }, "2026-10-24T03:32:49.000Z"], [null, "2026-10-24T00:01:00.000Z"]] as const) {
    const f = fake({ items: itemsOf(DS), graphql: () => ({ errors, data }) });
    await assert.rejects(collect(githubSource({ transport: f.transport, backfillMonths: LONG, now: NOW }).pulls(`github.com/${DS}`, null)), (e) => e instanceof RateLimited && e.resetAt.toISOString() === reset);
  }
});

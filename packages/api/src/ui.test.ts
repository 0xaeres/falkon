import { test, before, after } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { knowledgeBaseSchema, memorySignals } from "@falkon/shared";
import { createAdminApp } from "./admin";
import { ConnectionService, type CodeHost } from "./connections";
import { fakeEngineDb } from "./fakeEngineDb";
import { PrismaProductRegistry } from "./product";
import { ThreadService } from "./threads";
import { UiProductService } from "./ui";

process.env.FALKON_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
const TOKEN = "t".repeat(40);
const host: CodeHost = {
  async check() {
    return { scopes: ["repo"] };
  },
  async repos() {
    return [
      { full_name: "acme/app", default_branch: "main", pushed_at: "2026-10-19T10:00:00Z" },
      { full_name: "acme/lib", default_branch: "trunk", pushed_at: "2026-10-18T10:00:00Z" },
      { full_name: "other/tool", default_branch: "main", pushed_at: null },
    ];
  },
};

const engine = fakeEngineDb();
const signals = memorySignals();
const sent = { changed: 0, request: 0 };
signals.onChanged(() => sent.changed++);
signals.onRequest(() => sent.request++);
let clock = 0; // the service's knowledge-config cache clock; tests advance it past the 30 s TTL to re-read the config file
let admin: INestApplication;
let base: string;
before(async () => {
  const connections = new ConnectionService(engine.db as never, host);
  const ui = new UiProductService(engine.db, connections, () => clock, undefined, signals);
  admin = await createAdminApp(new PrismaProductRegistry(engine.db as never, signals), TOKEN, {}, connections, ui, new ThreadService(engine.db, ui, signals));
  await admin.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(admin.getHttpServer().address() as AddressInfo).port}`;
});
after(() => admin.close());

async function call(method: string, p: string, body?: unknown, auth = true) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
type J = Record<string, any>;
const APP = "github.com/acme/app";
const LIB = "github.com/acme/lib";
const TOOL = "github.com/other/tool";
const pick = (...ids: string[]) => ids.map((id) => ({ id, branch: "main" }));
const setup = (connectionId: string, id: string, ids: string[]) => ({ id, name: `${id} team`, provider: "github", host: "github.com", connectionId, repositories: pick(...ids) });
const connectionRow = (credentialId: string) => engine.connections.find((c) => c.credentialId === credentialId)!;
const reposOf = (credentialId: string) => connectionRow(credentialId).config.repos as string[];
const index = (name: string, over: J = {}) => {
  const row = engine.repos.find((r) => r.name === name) ?? engine.addRepo(name);
  Object.assign(row, { status: "INDEXED", headCommit: `${name.slice(-3)}abcdef012`, lastIndexedAt: new Date(), pushedAt: new Date(Date.now() - 60_000), ...over });
};

let cid: string;

test("create a connection, list its repositories, create a Product: status is building and the connection is asked to sync", async () => {
  cid = (await call("POST", "/connections", { provider: "github", method: "token", host: "https://github.com", token: "ghp_demo" })).json.id;
  const listed = (await call("GET", `/connections/${cid}/repositories`)).json as J[];
  assert.deepEqual(listed.map((r) => r.id), [APP, LIB, TOOL]);

  const created = await call("POST", "/ui/products", setup(cid, "alpha", [APP, LIB]));
  assert.equal(created.status, 201);
  assert.deepEqual([created.json.id, created.json.name, created.json.initials, created.json.provider, created.json.host, created.json.scenario, created.json.activeGeneration, created.json.connectionId], ["alpha", "alpha team", "AT", "github", "github.com", "building", null, cid]);
  assert.deepEqual(created.json.repositories.map((r: J) => [r.id, r.name, r.organization, r.revision]), [[APP, "app", "acme", ""], [LIB, "lib", "acme", ""]]);
  assert.deepEqual(reposOf(cid), ["acme/app", "acme/lib"]);
  assert.ok(connectionRow(cid).syncRequestedAt instanceof Date);
  const row = engine.product.rows.find((p) => p.slug === "alpha")!;
  assert.deepEqual([row.source, row.definition, row.repoNames, (row as J).connectionId], ["api", { include: [APP, LIB] }, [], connectionRow(cid).id]);

  const status = (await call("GET", "/ui/products/alpha/status")).json;
  assert.deepEqual([status.scenario, status.build, status.generation, status.sentence, status.progress, status.sync], ["building", "building", null, "Indexing 0 of 2 repositories.", 0, "current"]);
  assert.ok(typeof created.json.queuedAt === "number");
});

test("Repo rows that already exist resolve repoNames at create time", async () => {
  engine.addRepo(TOOL);
  await call("POST", "/ui/products", setup(cid, "pre", [TOOL]));
  assert.deepEqual(engine.product.rows.find((p) => p.slug === "pre")!.repoNames, [TOOL]);
  engine.product.rows.splice(engine.product.rows.findIndex((p) => p.slug === "pre"), 1);
  engine.repos.splice(0, engine.repos.length);
});

test("once the backend has indexed every repo, the status is current", async () => {
  connectionRow(cid).syncRequestedAt = null;
  index(APP);
  index(LIB);
  const s = (await call("GET", "/ui/products/alpha/status")).json;
  assert.deepEqual([s.scenario, s.build, s.stage, s.progress, s.verdict, s.nextGeneration], ["current", "idle", 4, 100, "Current", null]);
  assert.match(s.generation, /^g-[0-9a-f]{6}$/);
  const p = (await call("GET", "/ui/products/alpha")).json;
  assert.deepEqual([p.scenario, p.activeGeneration, p.repositories[0].revision, p.repositories[0].branch, p.repositories[1].branch], ["current", s.generation, "appabcd", "main", "main"]);
  assert.equal((await call("GET", "/ui/products")).json.length, 1);
});

test("retry marks the connection and only the failed repos; the status is the reply", async () => {
  index(LIB, { status: "FAILED", error: "RAW PROVIDER TEXT", lastIndexedAt: null });
  const failed = (await call("GET", "/ui/products/alpha/status")).json;
  assert.deepEqual([failed.scenario, failed.sync, failed.gaps], ["failed", "failed", [{ count: 1, title: "Repository failed to sync", detail: LIB }]]);
  assert.equal(JSON.stringify(failed).includes("RAW PROVIDER TEXT"), false);

  const r = await call("POST", "/ui/products/alpha/sync", { action: "retry" });
  assert.equal(r.status, 201);
  assert.equal(r.json.productId, "alpha");
  assert.ok(connectionRow(cid).syncRequestedAt instanceof Date);
  assert.ok(engine.repos.find((x) => x.name === LIB)!.indexRequestedAt instanceof Date);
  assert.equal(engine.repos.find((x) => x.name === APP)!.indexRequestedAt, null);
  assert.equal((await call("POST", "/ui/products/alpha/sync", { action: "dismiss" })).status, 400);
  assert.equal((await call("POST", "/ui/products/nope/sync", { action: "retry" })).status, 404);
  index(LIB);
});

test("edit changes the connection's repos union; editing one Product never removes a repo another uses", async () => {
  assert.equal((await call("POST", "/ui/products", setup(cid, "beta", [LIB, TOOL]))).status, 201);
  assert.deepEqual(reposOf(cid), ["acme/app", "acme/lib", "other/tool"]);

  connectionRow(cid).syncRequestedAt = null;
  const edited = await call("PATCH", "/ui/products/alpha", { name: "Alpha renamed", repositories: pick(APP) });
  assert.equal(edited.status, 200);
  assert.deepEqual([edited.json.id, edited.json.name, edited.json.repositories.map((r: J) => r.id)], ["alpha", "Alpha renamed", [APP]]);
  assert.deepEqual(reposOf(cid), ["acme/app", "acme/lib", "other/tool"], "lib stays for beta");
  assert.ok(connectionRow(cid).syncRequestedAt instanceof Date);
  assert.deepEqual(engine.product.rows.find((p) => p.slug === "alpha")!.definition, { include: [APP] });

  await call("PATCH", "/ui/products/beta", { name: "beta team", repositories: pick(TOOL) });
  assert.deepEqual(reposOf(cid), ["acme/app", "other/tool"], "lib is dropped once no Product uses it");
  assert.equal((await call("PATCH", "/ui/products/alpha", { name: "x", repositories: pick("github.com/acme/missing") })).status, 400);
  assert.deepEqual(reposOf(cid), ["acme/app", "other/tool"], "a rejected edit changes nothing");
});

test("config Products are listed and read, but PATCH is 409; a slug conflict is 409", async () => {
  engine.addRepo("ghe.example.com/team/svc", { status: "INDEXED", headCommit: "abc1234def", lastIndexedAt: new Date(), pushedAt: null });
  await engine.product.create({ data: { slug: "core", name: "core", source: "config", definition: { include: ["ghe.example.com/team/*"] }, repoNames: ["ghe.example.com/team/svc"] } });
  const core = (await call("GET", "/ui/products/core")).json;
  assert.deepEqual([core.provider, core.host, core.connectionId, core.scenario, core.repositories.map((r: J) => r.id)], ["github-enterprise", "ghe.example.com", undefined, "current", ["ghe.example.com/team/svc"]]);
  const patch = await call("PATCH", "/ui/products/core", { name: "core", repositories: pick(APP) });
  assert.deepEqual([patch.status, patch.json.errorCode], [409, "READ_ONLY"]);
  assert.equal(engine.product.rows.find((p) => p.slug === "core")!.name, "core");
  const dup = await call("POST", "/ui/products", setup(cid, "core", [APP]));
  assert.deepEqual([dup.status, dup.json.errorCode], [409, "ALREADY_EXISTS"]);
  assert.ok((await call("GET", "/ui/products")).json.some((p: J) => p.id === "core"));
});

test("a config Product over generic-git repos (bare host, not a url) lists without error", async () => {
  engine.addRepo("fixtures.test/atlas", { status: "INDEXED", headCommit: "abc1234def", lastIndexedAt: new Date(), external_codeHostUrl: "fixtures.test", external_codeHostType: "genericGitHost" });
  await engine.product.create({ data: { slug: "gitonly", name: "gitonly", source: "config", definition: { include: ["fixtures.test/*"] }, repoNames: ["fixtures.test/atlas"] } });
  const r = await call("GET", "/ui/products/gitonly");
  assert.deepEqual([r.status, r.json.host, r.json.provider], [200, "fixtures.test", "git"]);
  assert.equal((await call("GET", "/ui/products")).status, 200);
});

test("create validation: unknown connection, repo outside the listing, duplicates, extra keys, bad slug", async () => {
  const before = engine.product.rows.length;
  assert.equal((await call("POST", "/ui/products", setup("zzzzzzzzzzzzzzzzzzzzzz", "x1", [APP]))).status, 404);
  assert.equal((await call("POST", "/ui/products", setup(cid, "x2", ["github.com/acme/missing"]))).status, 400);
  assert.equal((await call("POST", "/ui/products", setup(cid, "x3", [APP, APP]))).status, 400);
  assert.equal((await call("POST", "/ui/products", { ...setup(cid, "x4", [APP]), extra: 1 })).status, 400);
  assert.equal((await call("POST", "/ui/products", setup(cid, "Bad_Slug", [APP]))).status, 400);
  assert.equal((await call("POST", "/ui/products", { ...setup(cid, "x5", [APP]), repositories: [] })).status, 400);
  assert.equal(engine.product.rows.length, before);
  assert.equal((await call("GET", "/ui/products/Bad_Slug")).status, 404);
  assert.equal((await call("GET", "/ui/products/missing/status")).status, 404);
  assert.equal((await call("PATCH", "/ui/products/alpha", { name: "x", repositories: pick(APP), connectionId: cid })).status, 400, "edit takes no connectionId");
  assert.equal((await call("GET", "/ui/products", undefined, false)).status, 401);
});

test("route enumeration: the admin listener has exactly the S20a routes, the six /ui/products routes and the five thread routes", () => {
  const router = (admin.getHttpAdapter().getInstance() as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
  const routes = router.stack.flatMap((l) => (l.route ? Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route!.path}`) : [])).sort();
  assert.deepEqual(routes, [
    "DELETE /connections/:id", "DELETE /products/:slug", "DELETE /ui/products/:slug/threads/:id",
    "GET /connections", "GET /connections/:id/repositories", "GET /products", "GET /products/:slug",
    "GET /ui/products", "GET /ui/products/:slug", "GET /ui/products/:slug/status",
    "GET /ui/products/:slug/threads", "GET /ui/products/:slug/threads/:id",
    "PATCH /ui/products/:slug",
    "POST /connections", "POST /products", "POST /ui/products", "POST /ui/products/:slug/sync",
    "POST /ui/products/:slug/threads", "POST /ui/products/:slug/threads/:id/messages",
    "PUT /connections/:id/token", "PUT /products/:slug",
  ].sort());
});

test("other /ui paths and methods stay 404", async () => {
  for (const [method, p] of [["PUT", "/ui/products/alpha"], ["DELETE", "/ui/products/alpha"], ["GET", "/ui"], ["GET", "/ui/products/alpha/sync"], ["POST", "/ui/products/alpha"], ["GET", "/ui/products/alpha/status/x"], ["PATCH", "/ui/products"], ["PATCH", "/products/alpha"], ["PUT", "/ui/products/alpha/threads"], ["GET", "/ui/products/alpha/threads/x/messages"], ["POST", "/ui/products/alpha/threads/x"], ["PATCH", "/ui/products/alpha/threads/x"], ["GET", "/ui/products/alpha/threads/x/messages/y"], ["POST", "/ui/products/alpha/query"]] as const)
    assert.equal((await call(method, p, method === "GET" ? undefined : {})).status, 404, `${method} ${p}`);
});

test("status carries knowledge: off, no-model, then scan states from the latest scan (excluded and knowledge repos ignored, error text never leaked)", async () => {
  const cfg = path.join(mkdtempSync(path.join(tmpdir(), "kb-")), "config.json");
  process.env.CONFIG_PATH = cfg;
  const knowledgeOf = async (slug = "kbp") => ((clock += 31_000), (await call("GET", `/ui/products/${slug}/status`)).json.knowledge);
  const scan = (repoId: number, status: string, startedAt: number, error: string | null = null) => engine.scans.push({ id: engine.scans.length + 1, repoId, status, startedAt: new Date(startedAt), error });
  try {
    await call("POST", "/ui/products", setup(cid, "kbp", [TOOL]));
    index(TOOL, { kbScannedCommit: null });
    const tool = engine.repos.find((r) => r.name === TOOL)!;

    writeFileSync(cfg, JSON.stringify({ knowledgeBase: { enabled: false } }));
    assert.deepEqual(await knowledgeOf(), { state: "off" });

    writeFileSync(cfg, JSON.stringify({ knowledgeBase: { enabled: true } }));
    delete process.env.LLM_BASE_URL;
    assert.deepEqual(await knowledgeOf(), { state: "no-model", detail: "No model configured" });

    Object.assign(process.env, { LLM_BASE_URL: "http://llm.test", LLM_API_KEY: "k", LLM_MODEL: "m" });
    assert.equal((await knowledgeOf()).state, "pending", "indexed, never scanned");
    scan(tool.id, "SUCCEEDED", 1);
    tool.kbScannedCommit = tool.headCommit;
    assert.equal((await knowledgeOf()).state, "ready");
    scan(tool.id, "FAILED", 2, "SECRET provider error text");
    clock += 31_000;
    const failed = await call("GET", "/ui/products/kbp/status");
    assert.deepEqual(failed.json.knowledge, { state: "failed", detail: "Last scan failed" });
    assert.ok(!JSON.stringify(failed.json).includes("SECRET"));
    scan(tool.id, "SUCCEEDED", 3);
    assert.equal((await knowledgeOf()).state, "ready", "only the latest scan counts");
    tool.kbExcluded = true;
    scan(tool.id, "RUNNING", 4);
    assert.equal((await knowledgeOf()).state, "ready", "excluded repo ignored");
    tool.kbExcluded = false;
    assert.equal((await knowledgeOf()).state, "scanning");
    const know = engine.addRepo("github.com/other/tool-knowledge", { kind: "KNOWLEDGE" });
    scan(know.id, "FAILED", 5);
    scan(tool.id, "BUDGET_EXHAUSTED", 6);
    assert.equal((await knowledgeOf()).state, "budget-exhausted", "knowledge-kind repos are not members");

    // a config-source Product gets it too: indexed at a head never scanned is pending, scanned at head is ready
    assert.equal((await knowledgeOf("gitonly")).state, "pending");
    engine.repos.find((r) => r.name === "fixtures.test/atlas")!.kbScannedCommit = "abc1234def";
    assert.equal((await knowledgeOf("gitonly")).state, "ready", "no scan row but scanned at head");
  } finally {
    delete process.env.CONFIG_PATH;
    for (const k of ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]) delete process.env[k];
  }
});

test("knowledge config is cached for 30 s, a failing load keeps the last value, and the config repos list limits the derivation", async () => {
  let now = 0;
  let calls = 0;
  let next: () => Promise<any> = async () => ({ enabled: true, repos: "all" });
  Object.assign(process.env, { LLM_BASE_URL: "http://llm.test", LLM_API_KEY: "k", LLM_MODEL: "m" });
  const svc = new UiProductService(engine.db, new ConnectionService(engine.db as never, host), () => now, () => (calls++, next()));
  const know = async () => (await svc.status("kbp")).knowledge!.state;
  try {
    const tool = engine.repos.find((r) => r.name === TOOL)!;
    tool.kbScannedCommit = "old"; // behind its head, no running/failed scan: pending when selected
    engine.scans.length = 0;
    assert.equal(await know(), "pending");
    next = async () => ({ enabled: false, repos: "all" });
    now = 29_999;
    assert.equal(await know(), "pending");
    assert.equal(calls, 1, "second call within the TTL does not reload");
    now = 30_000;
    assert.equal(await know(), "off");
    assert.equal(calls, 2, "reloads after the TTL");
    next = async () => { throw new Error("boom"); };
    now = 60_000;
    assert.equal(await know(), "off", "a throwing load keeps the last value");
    assert.equal(calls, 3);
    next = async () => ({ enabled: true, repos: ["github.com/nope/*"] });
    now = 90_000;
    assert.equal(await know(), "ready", "a repo the config does not select is never pending");
    next = async () => ({ enabled: true, repos: [TOOL] });
    now = 120_000;
    assert.equal(await know(), "pending");
  } finally {
    for (const k of ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]) delete process.env[k];
  }
  const fresh = new UiProductService(engine.db, new ConnectionService(engine.db as never, host), () => 0, async () => { throw new Error("never loaded"); });
  assert.equal((await fresh.status("kbp")).knowledge!.state, knowledgeBaseSchema.parse({}).enabled ? "no-model" : "off", "no value ever loaded: the schema default applies (no model env here)");
});

test("a member the connection's clean sync did not return is Skipped; before that sync it is only pending", async () => {
  const GONE = LIB; // listed by the code host, but the backend never made a Repo row for it
  engine.repos.splice(0, engine.repos.length);
  await call("POST", "/ui/products", setup(cid, "skp", [APP, GONE]));
  index(APP);
  const stateOf = async () => (await call("GET", "/ui/products/skp")).json.repositories.map((r: J) => [r.id, r.state]);
  assert.deepEqual(await stateOf(), [[APP, "indexed"], [GONE, "pending"]], "no sync since the Product was saved");
  Object.assign(connectionRow(cid), { syncedAt: new Date(Date.now() + 60_000), syncError: null, syncRequestedAt: null });
  assert.deepEqual(await stateOf(), [[APP, "indexed"], [GONE, "skipped"]]);
  const s = (await call("GET", "/ui/products/skp/status")).json;
  assert.deepEqual([s.scenario, s.sentence, s.gaps], ["current", `Answers use ${s.generation} from the latest revision of all 1 repository.`, [{ count: 1, title: "Repository skipped", detail: GONE }]]);
  connectionRow(cid).syncedAt = null;
});

test("writes publish: request for what the worker claims, changed for what a status or list shows, nothing for reads or refused writes", async () => {
  const seen = () => [sent.changed, sent.request];
  const step = async (run: () => Promise<unknown>) => {
    const [c, r] = seen();
    await run();
    return [sent.changed - c, sent.request - r];
  };
  assert.deepEqual(await step(() => call("POST", "/ui/products", setup(cid, "sig", [APP]))), [1, 1], "create");
  assert.deepEqual(await step(() => call("PATCH", "/ui/products/sig", { name: "sig 2", repositories: pick(APP, LIB) })), [1, 1], "edit");
  assert.deepEqual(await step(() => call("POST", "/ui/products/sig/sync", { action: "retry" })), [1, 1], "sync");
  assert.deepEqual(await step(() => call("PATCH", "/ui/products/sig", { name: "x", repositories: pick("github.com/acme/missing") })), [0, 0], "refused edit");
  assert.deepEqual(await step(() => call("GET", "/ui/products/sig/status")), [0, 0], "read");
  let id = "";
  assert.deepEqual(await step(async () => (id = (await call("POST", "/ui/products/sig/threads")).json.id)), [1, 0], "thread created");
  assert.deepEqual(await step(() => call("DELETE", "/ui/products/sig/threads/nope")), [0, 0], "unknown thread");
  assert.deepEqual(await step(() => call("DELETE", `/ui/products/sig/threads/${id}`)), [1, 0], "thread deleted");
  assert.deepEqual(await step(() => call("POST", "/products", { slug: "reg", name: "Reg", definition: { include: [APP] } })), [1, 0], "registry create");
  assert.deepEqual(await step(() => call("PUT", "/products/reg", { name: "Reg 2", definition: { include: [APP] } })), [1, 0], "registry update");
  assert.deepEqual(await step(() => call("DELETE", "/products/reg")), [1, 0], "registry delete");
  assert.deepEqual(await step(() => call("DELETE", "/products/reg")), [0, 0], "registry delete of a missing Product");
});

test("with no signal transport wired, writes still succeed (the default signals reach nobody)", async () => {
  const svc = new UiProductService(engine.db, new ConnectionService(engine.db as never, host), () => 0);
  await assert.doesNotReject(svc.sync("sig"));
});

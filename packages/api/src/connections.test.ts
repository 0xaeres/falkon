import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import type { PrismaClient } from "@sbc/db";
import { openCredential } from "@sbc/shared";
import { createAdminApp } from "./admin";
import { CodeHostError, ConnectionService, githubCodeHost, type CodeHost } from "./connections";
import { fakeDb } from "./fakeDb";
import { PrismaProductRegistry } from "./product";

process.env.FALKON_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
const TOKEN = "t".repeat(40);
const CANARY = "CANARY-TOKEN-0123456789";

// ---- fakes -------------------------------------------------------------------------------------------

type Row = Record<string, any>;
function fakeConnectionDb() {
  const connections: Row[] = [];
  const credentials: Row[] = [];
  let nextId = 1;
  const withCredential = (c: Row) => ({ ...c, credential: credentials.find((k) => k.id === c.credentialId) ?? null });
  const db = {
    credentials,
    connections,
    connection: {
      async create({ data }: { data: Row }) {
        const { credential, ...rest } = data;
        credentials.push({ createdAt: new Date(), rotatedAt: null, lastCheckedAt: null, ...credential.create });
        const row = { id: nextId++, createdAt: new Date(), syncError: null, ...rest, credentialId: credential.create.id };
        connections.push(row);
        return withCredential(row);
      },
      async findMany({ where }: { where: Row }) {
        return connections.filter((c) => c.source === where.source).map(withCredential);
      },
      async findFirst({ where }: { where: Row }) {
        const c = connections.find((row) => row.credentialId === where.credentialId && row.source === where.source);
        return c ? withCredential(c) : null;
      },
      async delete({ where }: { where: Row }) {
        connections.splice(connections.findIndex((c) => c.id === where.id), 1);
      },
    },
    credential: {
      async update({ where, data }: { where: Row; data: Row }) {
        return Object.assign(credentials.find((k) => k.id === where.id)!, data);
      },
      async delete({ where }: { where: Row }) {
        credentials.splice(credentials.findIndex((k) => k.id === where.id), 1);
      },
    },
  };
  return db as typeof db & Pick<PrismaClient, never>;
}

type Mode = "ok" | "invalid" | "unavailable" | "throws";
const hostRepos = [
  { full_name: "acme/app", default_branch: "main", pushed_at: "2026-10-19T10:00:00Z", private: true },
  { full_name: "acme/Lib", default_branch: "trunk", pushed_at: "2026-10-18T10:00:00Z", private: false },
  { full_name: "other/tool", default_branch: "main", pushed_at: null },
];
let mode: Mode = "ok";
const seen: { host: string; token: string }[] = [];
const stubHost: CodeHost = {
  async check(host, token) {
    seen.push({ host, token });
    if (mode === "invalid") throw new CodeHostError("invalid");
    if (mode === "unavailable") throw new CodeHostError("unavailable");
    if (mode === "throws") throw new Error(`provider said: bad credentials for ${token}`);
    return { scopes: ["repo", "read:org"] };
  },
  async repos(host, token) {
    seen.push({ host, token });
    if (mode === "throws") throw new Error(`provider said: bad credentials for ${token}`);
    return hostRepos;
  },
};

const captured: string[] = [];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
const tapped = (real: typeof realOut) => ((chunk: unknown, ...rest: unknown[]) => { captured.push(String(chunk)); return (real as (...a: unknown[]) => boolean)(chunk, ...rest); }) as typeof realOut;
const consoleLines: string[] = [];
const realConsole = { log: console.log, error: console.error, warn: console.warn };

let admin: INestApplication;
let base: string;
const db = fakeConnectionDb();
before(async () => {
  process.stdout.write = tapped(realOut);
  process.stderr.write = tapped(realErr);
  for (const k of ["log", "error", "warn"] as const) console[k] = (...a: unknown[]) => void consoleLines.push(a.map(String).join(" "));
  admin = await createAdminApp(new PrismaProductRegistry(fakeDb().db), TOKEN, {}, new ConnectionService(db as never, stubHost));
  await admin.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(admin.getHttpServer().address() as AddressInfo).port}`;
});
after(async () => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  Object.assign(console, realConsole);
  await admin.close();
});

const responses: string[] = [];
async function call(method: string, p: string, body?: unknown, auth = true) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  responses.push(`${res.status} ${JSON.stringify([...res.headers])} ${text}`);
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
const create = (token = "ghp_demo", host = "https://github.com") => call("POST", "/connections", { provider: "github", method: "token", host, token });

// ---- behaviour ---------------------------------------------------------------------------------------

test("create stores a sealed credential and an api connection, returns the DTO and records scopes", async () => {
  mode = "ok";
  const { status, json } = await create("ghp_demo");
  assert.equal(status, 201);
  assert.deepEqual(Object.keys(json).sort(), ["createdAt", "host", "id", "lastCheckedAt", "provider", "scopes", "status"]);
  assert.deepEqual([json.host, json.provider, json.status, json.scopes], ["github.com", "github", "ok", ["repo", "read:org"]]);
  assert.match(json.id, /^[A-Za-z0-9_-]{22}$/);
  const conn = db.connections.find((c) => c.credentialId === json.id)!;
  assert.deepEqual([conn.source, conn.connectionType, conn.name], ["api", "github", `ui-${json.id}`]);
  assert.deepEqual(conn.config, { type: "github", repos: [], token: { stored: json.id } });
  const row = db.credentials.find((k) => k.id === json.id)!;
  assert.equal(openCredential(row as never), "ghp_demo");
  assert.equal(seen.at(-1)!.token, "ghp_demo");
  assert.equal((await call("GET", "/connections")).json.length, db.connections.length);
});

test("a GitHub Enterprise host is recorded in the connection config", async () => {
  const { json } = await create("ghe_demo", "https://ghe.example.com");
  assert.deepEqual([json.host, json.provider], ["ghe.example.com", "github-enterprise"]);
  assert.deepEqual(db.connections.find((c) => c.credentialId === json.id)!.config, { type: "github", url: "https://ghe.example.com", repos: [], token: { stored: json.id } });
  assert.equal(seen.at(-1)!.host, "ghe.example.com");
});

test("status derives from the connection's syncError; an undecryptable credential is DECRYPT_FAILED, not an upstream outage", async () => {
  const { json: c } = await create("ghp_status");
  const conn = db.connections.find((x) => x.credentialId === c.id)!;
  conn.syncError = "Error: 401 SECRET provider text";
  const listed = (await call("GET", "/connections")).json.find((x: Row) => x.id === c.id);
  assert.equal(listed.status, "failed");
  assert.equal(JSON.stringify(listed).includes("SECRET"), false);
  assert.equal((await call("PUT", `/connections/${c.id}/token`, { token: "ghp_next" })).json.status, "failed");
  conn.syncError = null;
  assert.equal((await call("GET", "/connections")).json.find((x: Row) => x.id === c.id).status, "ok");
  const row = db.credentials.find((k) => k.id === c.id)!;
  row.ciphertext = Buffer.alloc(row.ciphertext.length, 1);
  const r = await call("GET", `/connections/${c.id}/repositories`);
  assert.deepEqual([r.status, r.json], [500, { statusCode: 500, errorCode: "DECRYPT_FAILED", message: "The stored credential could not be decrypted." }]);
});

test("code host failures return fixed errors and store nothing", async () => {
  const before = [db.connections.length, db.credentials.length];
  mode = "invalid";
  let r = await create();
  assert.deepEqual([r.status, r.json], [422, { statusCode: 422, errorCode: "INVALID_TOKEN", message: "The code host rejected this token." }]);
  for (const m of ["unavailable", "throws"] as const) {
    mode = m;
    r = await create();
    assert.deepEqual([r.status, r.json], [502, { statusCode: 502, errorCode: "UPSTREAM_UNAVAILABLE", message: "The code host could not be reached." }], m);
  }
  mode = "ok";
  assert.deepEqual([db.connections.length, db.credentials.length], before);
});

test("bodies are strict: unknown keys, method app, plain-http hosts and missing tokens are 400", async () => {
  for (const body of [
    { provider: "github", method: "token", host: "https://github.com", token: "x", extra: 1 },
    { provider: "github", method: "app", host: "https://github.com", token: "x" },
    { provider: "github", method: "token", host: "http://github.com", token: "x" },
    { provider: "github", method: "token", host: "https://github.com" },
  ])
    assert.equal((await call("POST", "/connections", body)).status, 400, JSON.stringify(body));
});

test("repositories: search by full_name, mapped to the contract shape, default branch only", async () => {
  const { json: c } = await create("ghp_search");
  const all = (await call("GET", `/connections/${c.id}/repositories`)).json;
  assert.deepEqual(all[0], {
    id: "github.com/acme/app", name: "app", organization: "acme", language: "", revision: "", updated: "2026-10-19T10:00:00.000Z", branches: ["main"], branch: "main", private: true,
  });
  assert.equal(seen.at(-1)!.token, "ghp_search");
  assert.deepEqual(all.map((r: Row) => (r as Row & { private?: boolean }).private), [true, false, undefined]);
  const hit = (await call("GET", `/connections/${c.id}/repositories?q=LIB`)).json;
  assert.deepEqual(hit.map((r: Row) => [r.id, r.branch]), [["github.com/acme/Lib", "trunk"]]);
  assert.deepEqual((await call("GET", `/connections/${c.id}/repositories?page=2`)).json, []);
  assert.equal((await call("GET", `/connections/${c.id}/repositories?page=9`)).status, 400);
  assert.equal((await call("GET", `/connections/${c.id}/repositories?x=1`)).status, 400);
});

test("rotating a token overwrites the ciphertext and sets rotatedAt; a rejected token changes nothing", async () => {
  const { json: c } = await create("ghp_old");
  const row = db.credentials.find((k) => k.id === c.id)!;
  const before = Buffer.from(row.ciphertext);
  mode = "invalid";
  assert.equal((await call("PUT", `/connections/${c.id}/token`, { token: "ghp_bad" })).status, 422);
  assert.deepEqual(row.ciphertext, before);
  mode = "ok";
  const r = await call("PUT", `/connections/${c.id}/token`, { token: "ghp_new" });
  assert.equal(r.status, 200);
  assert.equal(openCredential(row as never), "ghp_new");
  assert.ok(row.rotatedAt instanceof Date);
  assert.equal((await call("PUT", `/connections/${c.id}/token`, { token: "x", extra: 1 })).status, 400);
});

test("delete removes the connection and its credential row; unknown and malformed ids are the same 404", async () => {
  const { json: c } = await create("ghp_del");
  assert.equal((await call("DELETE", `/connections/${c.id}`)).status, 204);
  assert.ok(!db.credentials.some((k) => k.id === c.id));
  assert.ok(!db.connections.some((k) => k.credentialId === c.id));
  const unknown = await call("DELETE", `/connections/${c.id}`);
  const malformed = await call("DELETE", "/connections/not-an-id");
  assert.deepEqual([unknown.status, malformed.status], [404, 404]);
  assert.deepEqual(unknown.json, malformed.json);
  for (const [method, p] of [["GET", "/repositories"], ["PUT", "/token"]] as const)
    assert.equal((await call(method, `/connections/zzzzzzzzzzzzzzzzzzzzzz${p}`, method === "PUT" ? { token: "x" } : undefined)).status, 404);
});

test("connection routes are behind the admin bearer", async () => {
  assert.equal((await call("GET", "/connections", undefined, false)).status, 401);
});

// ---- route enumeration -------------------------------------------------------------------------------

test("route enumeration: the admin listener has exactly the allowlisted routes", () => {
  const router = (admin.getHttpAdapter().getInstance() as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
  const routes = router.stack.flatMap((l) => (l.route ? Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route!.path}`) : [])).sort();
  assert.deepEqual(routes, [
    "DELETE /connections/:id", "DELETE /products/:slug",
    "GET /connections", "GET /connections/:id/repositories", "GET /products", "GET /products/:slug",
    "POST /connections", "POST /products",
    "PUT /connections/:id/token", "PUT /products/:slug",
  ].sort());
});

test("other connection paths and methods stay 404", async () => {
  for (const [method, p] of [["GET", "/connections/x"], ["PUT", "/connections"], ["PATCH", "/connections/x"], ["POST", "/connections/x/token"], ["GET", "/connections/x/token"], ["DELETE", "/connections"], ["GET", "/connections/x/repositories/y"]] as const)
    assert.equal((await call(method, p, method === "GET" ? undefined : {})).status, 404, `${method} ${p}`);
});

// ---- canary ------------------------------------------------------------------------------------------

test("canary: the token appears in no response, thrown error or console output of any connections route", async () => {
  responses.length = 0;
  captured.length = 0;
  consoleLines.length = 0;
  mode = "ok";
  const { json: c } = await create(CANARY);
  await call("GET", "/connections");
  await call("GET", `/connections/${c.id}/repositories?q=app`);
  await call("PUT", `/connections/${c.id}/token`, { token: `${CANARY}-2` });
  for (const m of ["invalid", "unavailable", "throws"] as const) {
    mode = m;
    await create(CANARY);
    await call("PUT", `/connections/${c.id}/token`, { token: CANARY });
    await call("GET", `/connections/${c.id}/repositories`);
  }
  mode = "ok";
  await call("POST", "/connections", { provider: "github", method: "token", host: "https://github.com", token: CANARY, extra: CANARY });
  await call("DELETE", `/connections/${c.id}`);
  const everything = [...responses, ...captured, ...consoleLines, JSON.stringify(db.credentials.map((k) => ({ ...k, ciphertext: [...k.ciphertext] })))].join("\n");
  assert.equal(responses.length, 15);
  for (const needle of [CANARY, Buffer.from(CANARY).toString("base64"), Buffer.from(CANARY).toString("hex")])
    assert.equal(everything.includes(needle), false, needle);
});

// ---- the GitHub client -------------------------------------------------------------------------------

test("githubCodeHost: scopes from x-oauth-scopes, GHE base url, 3-page cap, 401/403 invalid, other failures unavailable", async () => {
  const calls: string[] = [];
  const page = (n: number) => Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${n}-${i}`, default_branch: "main", pushed_at: null }));
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer tok");
    if (url.includes("/user/repos")) return Response.json(page(Number(new URL(url).searchParams.get("page"))));
    return Response.json({}, { headers: { "x-oauth-scopes": "repo, read:org" } });
  }) as unknown as typeof fetch;
  const gh = githubCodeHost(fetchStub);
  assert.deepEqual(await gh.check("github.com", "tok"), { scopes: ["repo", "read:org"] });
  assert.equal(calls[0], "https://api.github.com/user");
  await gh.check("ghe.example.com", "tok");
  assert.equal(calls[1], "https://ghe.example.com/api/v3/user");
  assert.equal((await gh.repos("github.com", "tok")).length, 300);
  assert.deepEqual(calls.slice(2), [1, 2, 3].map((n) => `https://api.github.com/user/repos?per_page=100&sort=pushed&page=${n}`));
  const status = (code: number) => githubCodeHost((async () => new Response("provider text", { status: code })) as unknown as typeof fetch);
  for (const [code, kind] of [[401, "invalid"], [403, "invalid"], [500, "unavailable"], [404, "unavailable"]] as const)
    await assert.rejects(status(code).check("github.com", "tok"), (e: CodeHostError) => e.kind === kind, String(code));
  await assert.rejects(githubCodeHost((async () => { throw new Error("network"); }) as never).check("github.com", "tok"), (e: CodeHostError) => e.kind === "unavailable");
});

// ---- single reader -----------------------------------------------------------------------------------

test("nothing outside credentialStore.ts reads .ciphertext", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".next", "dist", ".git"].includes(name)) continue;
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\.(ts|tsx|mts)$/.test(name) && name !== "credentialStore.ts" && /\.ciphertext\b/.test(readFileSync(file, "utf8"))) hits.push(file);
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

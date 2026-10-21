import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { apiKeyAccessPolicy, type Scope } from "@sbc/shared";
import { createApp, SESSIONS, type McpHandlers } from "./app";
import type { SessionBindings } from "./sessions";
import type { ProductRegistry } from "./product";

const lookups: string[] = [];
const calls: { verb: string; url: string; session: string | null; scope: Scope }[] = [];
const products: Record<string, { id: number; repoNames: string[] }> = {
  core: { id: 1, repoNames: ["a/one", "a/two"] },
  other: { id: 2, repoNames: ["b/one"] },
};
const registry: Pick<ProductRegistry, "find"> = {
  async find(product) { lookups.push(product); return Object.hasOwn(products, product) ? structuredClone(products[product]) : undefined; },
};
let nextSession = 0;
/** A fake mcp.ts: a POST without a session id opens one (any id it is given is accepted, which is what the binding must guard). */
const mcp: McpHandlers = {
  post: async (req, scope) => {
    const session = req.headers.get("mcp-session-id");
    calls.push({ verb: "post", url: req.url, session, scope });
    return Response.json({ ok: true }, { headers: { "mcp-session-id": session ?? `s${++nextSession}` } });
  },
  delete: async (req, scope) => { calls.push({ verb: "delete", url: req.url, session: req.headers.get("mcp-session-id"), scope }); return new Response(null, { status: 204 }); },
};

async function listen(app: Awaited<ReturnType<typeof createApp>>) {
  await app.listen(0, "127.0.0.1");
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
before(async () => { app = await createApp(registry, mcp, { sessionCap: 3 }); base = await listen(app); });
after(() => app.close());

const PRODUCT_404 = { statusCode: 404, errorCode: "NOT_FOUND", message: "Product not found." };
const SESSION_404 = { statusCode: 404, errorCode: "NOT_FOUND", message: "Session not found." };
const open = async (product = "core", headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}/mcp/${product}`, { method: "POST", headers, body: "{}" });
  assert.equal(res.status, 200);
  await res.body?.cancel();
  return res.headers.get("mcp-session-id")!;
};
const post = (product: string, session?: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp/${product}`, { method: "POST", headers: { ...headers, ...(session === undefined ? {} : { "mcp-session-id": session }) }, body: "{}" });

test("POST and DELETE /mcp/<product> delegate with a scope built from the Product's repos", async () => {
  calls.length = 0;
  const session = await open();
  const del = await fetch(`${base}/mcp/core`, { method: "DELETE", headers: { "mcp-session-id": session } });
  assert.equal(del.status, 204);
  assert.deepEqual(calls.map((c) => c.verb), ["post", "delete"]);
  for (const { scope } of calls) {
    assert.equal(scope.principal, "anonymous");
    assert.equal(scope.allows("a/one"), true);
    assert.equal(scope.allows("a/two"), true);
    assert.equal(scope.allows("a/three"), false);
    assert.equal(scope.allows("b/one"), false);
    assert.equal(scope.allows("a/one::knowledge"), true, "a repo's knowledge base is visible with the repo (known gap until the KB cycle)");
    assert.notEqual(scope.repoFilter, null);
  }
});

test("P1: an unknown Product is 404 with no data and no fallback", async () => {
  calls.length = 0;
  for (const method of ["POST", "DELETE"]) {
    const res = await fetch(`${base}/mcp/nope`, { method, body: method === "POST" ? "{}" : undefined });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), PRODUCT_404);
  }
  assert.deepEqual(calls, []);
});

test("P1: a malformed Product name is 404 before any lookup", async () => {
  lookups.length = 0;
  calls.length = 0;
  const names = ["Core", "CORE", "-core", "a_b", "a.b", "a%2fb", "a%2Fb", "core%00", "core%20", "%20core", "a".repeat(64), "a".repeat(5000), "__proto__", "constructor", "%C4%87ore", "c%D0%BEre", "core%E2%80%8B", "..", "%2e%2e", "-n", "--foo", "core%0a"];
  for (const name of names) {
    const res = await fetch(`${base}/mcp/${name}`, { method: "POST", body: "{}" });
    assert.equal(res.status, 404, name);
    if (name !== ".." && name !== "%2e%2e") assert.deepEqual(await res.json(), PRODUCT_404, name);
  }
  assert.deepEqual(lookups.filter((l) => l !== "constructor"), [], "only syntactically valid names reach the registry");
  assert.deepEqual(calls, []);
});

test("GET /mcp/<product> is 405 with Allow: POST, DELETE", async () => {
  for (const name of ["core", "nope", "BAD"]) {
    const res = await fetch(`${base}/mcp/${name}`);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST, DELETE");
  }
});

test("P10: every other path and method is 404, including HEAD and OPTIONS, and no admin route exists here", async () => {
  calls.length = 0;
  const cases = [["GET", "/"], ["POST", "/"], ["POST", "/mcp"], ["POST", "/mcp/"], ["POST", "/mcp/core/extra"], ["POST", "/api/mcp"], ["POST", "/api/chat"],
    ["GET", "/products"], ["POST", "/products"], ["GET", "/products/core"], ["PUT", "/products/core"], ["DELETE", "/products/core"],
    ["PUT", "/mcp/core"], ["PATCH", "/mcp/core"], ["HEAD", "/mcp/core"], ["OPTIONS", "/mcp/core"], ["OPTIONS", "/"], ["HEAD", "/"]] as const;
  for (const [method, p] of cases) {
    const res = await fetch(`${base}${p}`, { method, body: method === "GET" || method === "HEAD" ? undefined : "{}" });
    assert.equal(res.status, 404, `${method} ${p}`);
  }
  assert.deepEqual(calls, []);
});

/** A raw request, so the Host header can be set (fetch forbids it). */
const raw = (url: string, method: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const r = http.request(url, { method, headers }, (res) => { res.resume(); resolve(res.statusCode!); });
    r.on("error", reject);
    r.end(method === "POST" ? "{}" : undefined);
  });

test("a Host header outside loopback (DNS rebinding) is refused before any lookup", async () => {
  lookups.length = 0;
  for (const host of ["evil.example", "127.0.0.1.evil.example", "localhost.evil.example", "localhost@evil.example"]) {
    assert.equal(await raw(`${base}/mcp/core`, "POST", { host }), 403, host);
  }
  for (const host of ["localhost", "localhost:1", "127.0.0.1:9", "[::1]:3001", "LOCALHOST"]) assert.equal(await raw(`${base}/mcp/nope`, "POST", { host }), 404, host);
  assert.deepEqual(lookups, ["nope", "nope", "nope", "nope", "nope"]);
  const proxied = await createApp(registry, mcp, { env: { API_ALLOWED_HOSTS: "falkon.internal" } });
  try { assert.equal(await raw(`${await listen(proxied)}/mcp/nope`, "POST", { host: "falkon.internal" }), 404); } finally { await proxied.close(); }
});

test("P11: a session presented under another Product path is rejected and starts no session", async () => {
  calls.length = 0;
  const session = await open("core");
  for (const method of ["POST", "DELETE"]) {
    const res = await fetch(`${base}/mcp/other`, { method, headers: { "mcp-session-id": session }, body: method === "POST" ? "{}" : undefined });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), SESSION_404);
  }
  assert.deepEqual(calls.map((c) => c.verb), ["post"], "only the opening request reached mcp.ts");
  assert.equal((await post("core", session)).status, 200, "the session still works under its own Product");
});

test("P11: an id this layer never bound is rejected instead of reaching mcp.ts (which would open a session under it)", async () => {
  calls.length = 0;
  for (const id of ["never-bound", "", "s1, s2", "../s1", "é"]) {
    const res = await fetch(`${base}/mcp/core`, { method: "POST", headers: { "mcp-session-id": encodeURIComponent(id) || "" }, body: "{}" });
    assert.equal(res.status, 404, JSON.stringify(id));
    assert.deepEqual(await res.json(), SESSION_404);
  }
  const del = await fetch(`${base}/mcp/core`, { method: "DELETE" });
  assert.equal(del.status, 404, "DELETE without a session id never reaches mcp.ts");
  assert.deepEqual(calls, []);
});

test("P11: after the Product's membership changes the session is rejected, closed in mcp.ts, and not replaced", async () => {
  const session = await open("core");
  calls.length = 0;
  products.core!.repoNames = ["a/one"];
  try {
    const res = await post("core", session);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), SESSION_404);
    assert.deepEqual(calls.map((c) => [c.verb, c.session]), [["delete", session]], "the stale session is closed, no POST reached mcp.ts");
    products.core!.repoNames = ["a/one", "a/two"];
    assert.equal((await post("core", session)).status, 404, "the binding is gone even when membership changes back");
  } finally { products.core!.repoNames = ["a/one", "a/two"]; }
});

test("P11: a Product deleted and recreated under the same slug does not inherit sessions", async () => {
  const session = await open("core");
  products.core!.id = 99;
  try { assert.equal((await post("core", session)).status, 404); } finally { products.core!.id = 1; }
});

test("P11: DELETE removes the binding; the session registry is capped and evicts the least recently used", async () => {
  const fresh = await createApp(registry, mcp, { sessionCap: 3 });
  const url = await listen(fresh);
  try {
    const openOn = async () => { const r = await fetch(`${url}/mcp/core`, { method: "POST", body: "{}" }); await r.body?.cancel(); return r.headers.get("mcp-session-id")!; };
    const [a, b, c] = [await openOn(), await openOn(), await openOn()];
    // touch a, so b becomes least recently used
    assert.equal((await fetch(`${url}/mcp/core`, { method: "POST", headers: { "mcp-session-id": a }, body: "{}" })).status, 200);
    calls.length = 0;
    const d = await openOn();
    assert.equal(fresh.get<SessionBindings>(SESSIONS).size, 3);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(calls.filter((x) => x.verb === "delete").map((x) => x.session), [b], "the evicted session is closed in mcp.ts");
    for (const [id, status] of [[a, 200], [b, 404], [c, 200], [d, 200]] as const) assert.equal((await fetch(`${url}/mcp/core`, { method: "POST", headers: { "mcp-session-id": id }, body: "{}" })).status, status, id);
    assert.equal((await fetch(`${url}/mcp/core`, { method: "DELETE", headers: { "mcp-session-id": c } })).status, 204);
    assert.equal(fresh.get<SessionBindings>(SESSIONS).size, 2);
    assert.equal((await fetch(`${url}/mcp/core`, { method: "POST", headers: { "mcp-session-id": c }, body: "{}" })).status, 404);
    for (let i = 0; i < 50; i++) await openOn();
    assert.equal(fresh.get<SessionBindings>(SESSIONS).size, 3, "never grows past the cap");
  } finally { await fresh.close(); }
});

// ---- AUTH_MODE=apiKey on the product listener ----

const sha = (k: string) => createHash("sha256").update(k).digest("hex");
const accessFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "falkon-api-keys-")), "access.json");
fs.writeFileSync(accessFile, JSON.stringify({ keys: [
  { name: "narrow", sha256: sha("narrow-key"), repos: ["a/one"] },
  { name: "wide", sha256: sha("wide-key"), repos: ["*"] },
  { name: "elsewhere", sha256: sha("elsewhere-key"), repos: ["z/*"] },
] }));

test("apiKey: name syntax, then 401 (same body for a missing or bad key, no Product lookup), then 404 for unknown or empty-intersection Products", async () => {
  const keyed = await createApp(registry, mcp, { policy: apiKeyAccessPolicy(accessFile) });
  const url = await listen(keyed);
  const call = (product: string, auth?: string) => fetch(`${url}/mcp/${product}`, { method: "POST", headers: auth ? { authorization: auth } : {}, body: "{}" });
  try {
    lookups.length = 0;
    const bodies = new Set<string>();
    for (const auth of [undefined, "Bearer bad", "narrow-key", "Basic bmFycm93LWtleQ==", "Bearer  narrow-key", "Bearer wide-key,narrow-key"]) {
      for (const product of ["core", "nope"]) {
        const res = await call(product, auth);
        assert.equal(res.status, 401, `${auth} ${product}`);
        assert.equal(res.headers.get("www-authenticate"), "Bearer");
        bodies.add(await res.text());
      }
    }
    assert.equal(bodies.size, 1, "one 401 body, whatever the key or Product");
    assert.deepEqual(lookups, [], "no Product is looked up for an unauthenticated caller");
    assert.equal((await call("BAD", "Bearer bad")).status, 404, "malformed names are rejected before authentication");
    const notFound = new Set<string>();
    for (const [product, key] of [["nope", "wide-key"], ["core", "elsewhere-key"], ["other", "narrow-key"]]) {
      const res = await call(product!, `Bearer ${key}`);
      assert.equal(res.status, 404, `${product} ${key}`);
      notFound.add(await res.text());
    }
    assert.deepEqual([...notFound], [JSON.stringify(PRODUCT_404)], "an empty intersection looks exactly like an unknown Product");
    calls.length = 0;
    assert.equal((await call("core", "Bearer narrow-key")).status, 200);
    assert.equal((await call("core", "Bearer wide-key")).status, 200);
    const [narrow, wide] = calls.map((c) => c.scope);
    assert.equal(narrow!.principal, "key:narrow");
    assert.deepEqual([narrow!.allows("a/one"), narrow!.allows("a/two")], [true, false], "narrow never widens");
    assert.deepEqual([wide!.allows("a/one"), wide!.allows("a/two"), wide!.allows("b/one"), wide!.allows("x/y")], [true, true, false, false], "a * key is still limited to the Product");
  } finally { await keyed.close(); }
});

test("apiKey P11: a session is bound to its principal and to the key's scope at creation", async () => {
  const keyed = await createApp(registry, mcp, { policy: apiKeyAccessPolicy(accessFile) });
  const url = await listen(keyed);
  const call = (key: string, session?: string) => fetch(`${url}/mcp/core`, { method: "POST", headers: { authorization: `Bearer ${key}`, ...(session ? { "mcp-session-id": session } : {}) }, body: "{}" });
  try {
    const opened = await call("wide-key");
    const session = opened.headers.get("mcp-session-id")!;
    calls.length = 0;
    const stolen = await call("narrow-key", session);
    assert.equal(stolen.status, 404, "another principal cannot use or probe the session");
    assert.deepEqual(await stolen.json(), SESSION_404);
    assert.deepEqual(calls, []);
    assert.equal((await call("wide-key", session)).status, 200);
    // the key's scope narrows after creation: same principal, different effective set
    const keys = JSON.parse(fs.readFileSync(accessFile, "utf8"));
    keys.keys[1].repos = ["a/one"];
    fs.writeFileSync(accessFile, JSON.stringify(keys));
    fs.utimesSync(accessFile, new Date(), new Date(Date.now() + 60_000));
    calls.length = 0;
    assert.equal((await call("wide-key", session)).status, 404);
    assert.deepEqual((calls as unknown as { verb: string }[]).map((c) => c.verb), ["delete"]);
  } finally { await keyed.close(); }
});

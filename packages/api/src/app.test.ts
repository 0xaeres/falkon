import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import type { Scope } from "@sbc/shared";
import { createApp, type McpHandlers } from "./app";
import type { ProductResolver } from "./product";

const lookups: string[] = [];
const calls: { verb: string; url: string; scope: Scope }[] = [];
const resolver: ProductResolver = {
  async repoNames(product) { lookups.push(product); return product === "core" ? ["a/one", "a/two"] : undefined; },
};
const mcp: McpHandlers = {
  post: async (req, scope) => { calls.push({ verb: "post", url: req.url, scope }); return Response.json({ ok: true }); },
  delete: async (req, scope) => { calls.push({ verb: "delete", url: req.url, scope }); return new Response(null, { status: 204 }); },
};
let app: INestApplication;
let base: string;
before(async () => {
  app = await createApp(resolver, mcp);
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
after(() => app.close());

test("POST and DELETE /mcp/<product> delegate with a scope built from the Product's repos", async () => {
  calls.length = 0;
  const post = await fetch(`${base}/mcp/core`, { method: "POST", body: "{}" });
  const del = await fetch(`${base}/mcp/core`, { method: "DELETE" });
  assert.equal(post.status, 200);
  assert.deepEqual(await post.json(), { ok: true });
  assert.equal(del.status, 204);
  assert.deepEqual(calls.map((c) => c.verb), ["post", "delete"]);
  for (const { scope } of calls) {
    assert.equal(scope.principal, "anonymous");
    assert.equal(scope.allows("a/one"), true);
    assert.equal(scope.allows("a/two"), true);
    assert.equal(scope.allows("a/three"), false);
    assert.equal(scope.allows("a/one::knowledge"), true, "a repo's knowledge base is visible with the repo");
    assert.notEqual(scope.repoFilter, null);
  }
});

test("an unknown Product is 404 with no data and no fallback", async () => {
  calls.length = 0;
  for (const method of ["POST", "DELETE"]) {
    const res = await fetch(`${base}/mcp/nope`, { method, body: method === "POST" ? "{}" : undefined });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { statusCode: 404, errorCode: "NOT_FOUND", message: "Product not found." });
  }
  assert.deepEqual(calls, []);
});

test("a malformed Product name is 404 before any lookup", async () => {
  lookups.length = 0;
  for (const name of ["Core", "-core", "a_b", "a.b", "a%2fb", "a".repeat(64)]) {
    const res = await fetch(`${base}/mcp/${name}`, { method: "POST", body: "{}" });
    assert.equal(res.status, 404, name);
    assert.deepEqual(await res.json(), { statusCode: 404, errorCode: "NOT_FOUND", message: "Product not found." });
  }
  assert.deepEqual(lookups, []);
});

test("GET /mcp/<product> is 405 with Allow: POST, DELETE", async () => {
  for (const name of ["core", "nope", "BAD"]) {
    const res = await fetch(`${base}/mcp/${name}`);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST, DELETE");
  }
});

test("every other path and method is 404", async () => {
  calls.length = 0;
  for (const [method, path] of [["GET", "/"], ["POST", "/"], ["POST", "/mcp"], ["POST", "/mcp/"], ["POST", "/mcp/core/extra"], ["POST", "/api/mcp"], ["POST", "/api/ee/mcp"], ["GET", "/products"], ["PUT", "/mcp/core"], ["PATCH", "/mcp/core"]] as const) {
    const res = await fetch(`${base}${path}`, { method, body: method === "GET" ? undefined : "{}" });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  assert.deepEqual(calls, []);
});

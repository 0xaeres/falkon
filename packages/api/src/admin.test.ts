import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { createAdminApp, MAX_BODY_BYTES } from "./admin";
import { createApp } from "./app";
import { fakeDb } from "./fakeDb";
import { PrismaProductRegistry } from "./product";

const TOKEN = "t".repeat(40);
const { db, rows } = fakeDb([{ slug: "core", source: "config", name: "core", description: "From config", definition: { include: ["github.com/acme/*"] }, repoNames: ["github.com/acme/app"] }]);
const registry = new PrismaProductRegistry(db);
let admin: INestApplication;
let product: INestApplication;
let base: string;
let productBase: string;
const url = (app: INestApplication) => `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
before(async () => {
  admin = await createAdminApp(registry, TOKEN, {});
  await admin.listen(0, "127.0.0.1");
  base = url(admin);
  product = await createApp(registry, { post: async () => Response.json({ ok: true }), delete: async () => new Response(null, { status: 204 }) });
  await product.listen(0, "127.0.0.1");
  productBase = url(product);
});
after(async () => { await admin.close(); await product.close(); });

const json = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = json) =>
  fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
type Body = Record<string, any>;
const valid = { slug: "mine", name: "Mine", description: "Mine only", definition: { include: ["github.com/acme/app"], includeConnections: ["other"] } };

test("create, read, list, update and delete an api Product", async () => {
  const created = await send("POST", "/products", valid);
  assert.equal(created.status, 201);
  const body = (await created.json()) as Body;
  assert.deepEqual([body.slug, body.source, body.name, body.description, body.repoNames, body.definition], ["mine", "api", "Mine", "Mine only", ["github.com/acme/app", "github.com/other/tool"], valid.definition]);
  assert.equal(body.id, undefined);
  assert.equal((await send("GET", "/products/mine")).status, 200);
  assert.deepEqual(((await (await send("GET", "/products")).json()) as Body[]).map((p) => p.slug), ["core", "mine"]);
  const updated = await send("PUT", "/products/mine", { name: "Mine 2", definition: { include: ["github.com/acme/*"] } });
  assert.equal(updated.status, 200);
  const u = (await updated.json()) as Body;
  assert.deepEqual([u.slug, u.source, u.name, u.description, u.repoNames], ["mine", "api", "Mine 2", null, ["github.com/acme/app", "github.com/acme/lib"]]);
  assert.equal((await send("POST", "/products", valid)).status, 409, "slug taken");
  const del = await send("DELETE", "/products/mine");
  assert.equal(del.status, 204);
  assert.equal((await send("GET", "/products/mine")).status, 404);
  assert.equal((await send("DELETE", "/products/mine")).status, 404);
});

test("a membership change through the admin API applies to the next product request (fresh reads)", async () => {
  await send("POST", "/products", { ...valid, slug: "fresh" });
  const call = () => fetch(`${productBase}/mcp/fresh`, { method: "POST", body: "{}" });
  assert.equal((await call()).status, 200);
  await send("DELETE", "/products/fresh");
  assert.equal((await call()).status, 404);
});

test("config Products are read-only through the API (409) and unchanged", async () => {
  const before = structuredClone(rows.find((r) => r.slug === "core"));
  for (const [method, body] of [["PUT", { name: "x", definition: {} }], ["DELETE", undefined]] as const) {
    const res = await send(method, "/products/core", body);
    assert.equal(res.status, 409, method);
    assert.equal(((await res.json()) as Body).errorCode, "READ_ONLY");
  }
  assert.deepEqual(rows.find((r) => r.slug === "core"), before);
  assert.equal((await send("POST", "/products", { ...valid, slug: "core" })).status, 409);
});

test("PUT cannot change slug or source; unknown keys anywhere are rejected", async () => {
  await send("POST", "/products", { ...valid, slug: "pinned" });
  for (const body of [
    { slug: "other", name: "x", definition: {} },
    { source: "config", name: "x", definition: {} },
    { name: "x", definition: {}, id: 1 },
    { name: "x", definition: { include: ["a"], description: "x" } },
    { name: "x", definition: { repoNames: ["github.com/secret/x"] } },
    { name: "x", definition: {}, repoNames: ["github.com/secret/x"] },
  ]) {
    const res = await send("PUT", "/products/pinned", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(((await res.json()) as Body).errorCode, "INVALID_REQUEST_BODY");
  }
  const kept = (await (await send("GET", "/products/pinned")).json()) as Body;
  assert.deepEqual([kept.slug, kept.source, kept.name], ["pinned", "api", "Mine"]);
  assert.equal((await send("POST", "/products", { ...valid, slug: "x1", source: "config" })).status, 400);
  assert.equal((await send("POST", "/products", { ...valid, slug: "x2", repoNames: ["github.com/secret/x"] })).status, 400, "membership is resolved, never supplied");
});

test("slug syntax is enforced on create and on every :slug route", async () => {
  for (const slug of ["", "Mine", "-a", "a_b", "a/b", "a".repeat(64), "__proto__", "cоre", "a\u0000", 7, null]) {
    assert.equal((await send("POST", "/products", { ...valid, slug })).status, 400, JSON.stringify(slug));
  }
  for (const slug of ["Mine", "a_b", "a%2Fb", "%2e%2e", "__proto__", "a".repeat(64), "c%D0%BEre"]) {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await send(method, `/products/${slug}`, method === "PUT" ? { name: "x", definition: {} } : undefined);
      assert.equal(res.status, 404, `${method} ${slug}`);
    }
  }
});

test("bodies: JSON only, 64 KiB cap, field limits", async () => {
  assert.equal((await send("POST", "/products", JSON.stringify(valid), { "content-type": "text/plain" })).status, 415);
  assert.equal((await send("POST", "/products", "slug=x", { "content-type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await send("POST", "/products", JSON.stringify(valid), {})).status, 415);
  assert.equal((await send("POST", "/products", "{not json")).status, 400);
  assert.equal((await send("POST", "/products", "[]")).status, 400);
  const big = { ...valid, slug: "big", description: "x".repeat(MAX_BODY_BYTES) };
  assert.equal((await send("POST", "/products", big)).status, 413);
  // a chunked body without Content-Length is capped while it streams
  const chunked = await new Promise<number>((resolve, reject) => {
    const r = http.request(`${base}/products`, { method: "POST", headers: { ...json, "transfer-encoding": "chunked" } }, (res) => { res.resume(); resolve(res.statusCode!); });
    r.on("error", reject);
    for (let i = 0; i < 80; i++) r.write("x".repeat(1024));
    r.end();
  });
  assert.equal(chunked, 413);
  for (const body of [
    { ...valid, slug: "f1", name: "" },
    { ...valid, slug: "f2", name: "  " },
    { ...valid, slug: "f3", name: "x".repeat(201) },
    { ...valid, slug: "f4", description: "x".repeat(2001) },
    { ...valid, slug: "f5", definition: { include: Array(201).fill("a") } },
    { ...valid, slug: "f6", definition: { include: ["x".repeat(257)] } },
    { ...valid, slug: "f7", definition: { include: [""] } },
    { ...valid, slug: "f8", definition: { include: ["a\u0000b"] } },
    { ...valid, slug: "f9", definition: { include: "github.com/*" } },
    { ...valid, slug: "f10", definition: null },
    { slug: "f11", name: "x" },
    { ...valid, slug: "f12", name: "a\u0000b" },
    { ...valid, slug: "f13", description: "a\u0000b" },
  ]) assert.equal((await send("POST", "/products", body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal(rows.some((r) => /^(big|f\d+)$/.test(r.slug)), false);
});

test("P10: the admin listener serves the registry routes only; /mcp and every other path or method is 404", async () => {
  const cases = [["POST", "/mcp/core"], ["DELETE", "/mcp/core"], ["GET", "/mcp/core"], ["POST", "/api/mcp"], ["GET", "/"], ["PATCH", "/products/core"], ["PUT", "/products"],
    ["DELETE", "/products"], ["POST", "/products/core"], ["HEAD", "/products"], ["OPTIONS", "/products"], ["GET", "/products/core/extra"], ["GET", "/admin/products"]] as const;
  for (const [method, path] of cases) {
    const res = await fetch(`${base}${path}`, { method, headers: json, body: method === "GET" || method === "HEAD" ? undefined : "{}" });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
});

test("the admin listener refuses a non-loopback Host (DNS rebinding)", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const r = http.request(`${base}/products`, { headers: { host: "attacker.example", authorization: `Bearer ${TOKEN}` } }, (res) => { res.resume(); resolve(res.statusCode!); });
    r.on("error", reject);
    r.end();
  });
  assert.equal(status, 403);
});

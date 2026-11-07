import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { createAdminApp } from "./admin";

const TOKEN = "t".repeat(40);
let admin: INestApplication;
let base: string;
before(async () => {
  admin = await createAdminApp(TOKEN, {});
  await admin.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(admin.getHttpServer().address() as AddressInfo).port}`;
});
after(async () => { await admin.close(); });

const auth: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
const send = (method: string, path: string, headers: Record<string, string> = auth) =>
  fetch(`${base}${path}`, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : "{}" });

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PATHS = ["/products", "/products/core", "/products/core/extra", "/products/Bad_Slug", "/products/%2e%2e", "/products/__proto__", "/products/", "/admin/products"];

test("the operator /products routes are gone: every method on every /products path is 404 behind the bearer", async () => {
  for (const method of [...METHODS, "HEAD", "OPTIONS"]) for (const p of PATHS) assert.equal((await send(method, p)).status, 404, `${method} ${p}`);
});

test("no auth oracle: tokenless and wrong-token requests to a removed path are 401, whatever the method", async () => {
  for (const headers of [{}, { authorization: `Bearer ${"x".repeat(40)}` }] as Record<string, string>[]) {
    for (const method of METHODS) for (const p of PATHS) assert.equal((await send(method, p, headers)).status, 401, `${method} ${p}`);
  }
});

test("a token in the query of a removed path is not a credential", async () => {
  for (const method of METHODS) assert.equal((await send(method, `/products?token=${TOKEN}`, {})).status, 401, method);
});

test("/products/... is not routed to /ui: the removed paths and the /ui paths are separate", async () => {
  // /ui has no products listener here (no UiProductService given), and /products/... must not fall into it either way.
  assert.equal((await send("GET", "/products/core/threads")).status, 404);
  assert.equal((await send("GET", "/ui/products")).status, 404, "no UiProductService wired: nothing under /ui");
});

test("/mcp and every other path is 404 on the admin listener", async () => {
  for (const [method, p] of [["POST", "/mcp/core"], ["DELETE", "/mcp/core"], ["GET", "/mcp/core"], ["POST", "/api/mcp"], ["GET", "/"]] as const) assert.equal((await send(method, p)).status, 404, `${method} ${p}`);
});

test("the admin listener refuses a non-loopback Host (DNS rebinding)", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const r = http.request(`${base}/connections`, { headers: { host: "attacker.example", ...auth } }, (res) => { res.resume(); resolve(res.statusCode!); });
    r.on("error", reject);
    r.end();
  });
  assert.equal(status, 403);
});

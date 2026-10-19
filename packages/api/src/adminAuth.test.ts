import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { adminToken, createAdminApp, startAdmin } from "./admin";
import { createApp } from "./app";
import { fakeDb } from "./fakeDb";
import { PrismaProductRegistry } from "./product";

const TOKEN = "s3cr3t-".repeat(6);
const { db } = fakeDb([{ slug: "core", source: "config", name: "core", description: null, definition: { include: ["github.com/acme/*"] }, repoNames: ["github.com/acme/app"] }]);
const registry = new PrismaProductRegistry(db);
let admin: INestApplication;
let product: INestApplication;
const port = (app: INestApplication) => (app.getHttpServer().address() as AddressInfo).port;

// Everything written to stdout or stderr while the suite runs; the token must never be in it.
const captured: string[] = [];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
before(async () => {
  for (const [stream, real] of [[process.stdout, realOut], [process.stderr, realErr]] as const) {
    stream.write = ((chunk: unknown, ...rest: unknown[]) => { captured.push(String(chunk)); return (real as (...a: unknown[]) => boolean)(chunk, ...rest); }) as typeof stream.write;
  }
  admin = await createAdminApp(registry, TOKEN, {});
  await admin.listen(0, "127.0.0.1");
  product = await createApp(registry, { post: async () => Response.json({ ok: true }), delete: async () => new Response(null, { status: 204 }) });
  await product.listen(0, "127.0.0.1");
});
after(async () => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  await admin.close();
  await product.close();
});

type Res = { status: number; body: string; headers: http.IncomingHttpHeaders };
/** Raw request, so repeated headers and odd values are sent exactly as given. */
const raw = (method: string, path: string, headers: string[] = [], body?: string) =>
  // A flat header array gets no automatic Host, so add one unless the caller sets it.
  new Promise<Res>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: port(admin), method, path, headers: headers.some((h, i) => i % 2 === 0 && h.toLowerCase() === "host") ? headers : [...headers, "host", "127.0.0.1"] }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode!, body: text, headers: res.headers }));
    });
    r.on("error", reject);
    r.end(body);
  });
const call = (method: string, path: string, auth: string[], body?: string) => raw(method, path, [...auth, "content-type", "application/json"], body);

const BAD: [string, string[]][] = [
  ["no header", []],
  ["lowercase scheme", ["authorization", `bearer ${TOKEN}`]],
  ["Basic", ["authorization", `Basic ${TOKEN}`]],
  ["bare token", ["authorization", TOKEN]],
  ["empty value", ["authorization", ""]],
  ["scheme only", ["authorization", "Bearer "]],
  ["whitespace", ["authorization", "   "]],
  ["extra space", ["authorization", `Bearer  ${TOKEN}`]],
  ["prefix of token", ["authorization", `Bearer ${TOKEN.slice(0, -1)}`]],
  ["wrong token", ["authorization", `Bearer ${"x".repeat(TOKEN.length)}`]],
  ["two headers, good then bad", ["authorization", `Bearer ${TOKEN}`, "authorization", "Bearer nope"]],
  ["two headers, bad then good", ["authorization", "Bearer nope", "Authorization", `Bearer ${TOKEN}`]],
  ["two identical good headers", ["authorization", `Bearer ${TOKEN}`, "authorization", `Bearer ${TOKEN}`]],
];

test("every bad credential gets the identical 401, on every route, method and unmatched path", async () => {
  const routes: [string, string, string?][] = [["GET", "/products"], ["POST", "/products", "{}"], ["GET", "/products/core"], ["PUT", "/products/core", "{}"], ["DELETE", "/products/core"], ["GET", "/nope"], ["POST", "/mcp/core", "{}"]];
  let reference: string | undefined;
  for (const [name, auth] of BAD) {
    for (const [method, path, body] of routes) {
      const res = await call(method, path, auth, body);
      assert.equal(res.status, 401, `${name}: ${method} ${path}`);
      assert.equal(res.headers["www-authenticate"], "Bearer");
      const shape = JSON.stringify([res.body, res.headers["content-type"], res.headers["www-authenticate"]]);
      reference ??= shape;
      assert.equal(shape, reference, `${name}: ${method} ${path} differs from the first 401`);
    }
  }
  assert.deepEqual(JSON.parse(reference!)[0], '{"statusCode":401,"errorCode":"UNAUTHORIZED","message":"Unauthorized."}');
});

test("a token in the query, body, cookie or another header is not a credential", async () => {
  const t = encodeURIComponent(TOKEN);
  for (const path of [`/products?token=${t}`, `/products?authorization=Bearer%20${t}`, `/products?access_token=${t}`]) assert.equal((await call("GET", path, [])).status, 401, path);
  assert.equal((await call("POST", "/products", [], JSON.stringify({ token: TOKEN, authorization: `Bearer ${TOKEN}` }))).status, 401);
  assert.equal((await raw("GET", "/products", ["cookie", `token=${TOKEN}; authorization=Bearer ${TOKEN}`, "x-admin-token", TOKEN, "x-authorization", `Bearer ${TOKEN}`])).status, 401);
});

test("unauthenticated requests are refused before the body is read or validated", async () => {
  // A huge declared body, a bad content type and invalid JSON all give the same 401, never 413, 415 or 400.
  for (const headers of [["content-type", "application/json", "content-length", "99999999"], ["content-type", "text/plain"], ["content-type", "application/json"]]) {
    const res = await raw("POST", "/products", headers, "{not json");
    assert.equal(res.status, 401, headers.join(" "));
  }
});

test("a rejected request does not reveal whether the product exists", async () => {
  const known = await call("GET", "/products/core", []);
  const unknown = await call("GET", "/products/zzz", []);
  assert.deepEqual([known.status, known.body], [unknown.status, unknown.body]);
});

test("the correct token reaches each of the five routes", async () => {
  const auth = ["authorization", `Bearer ${TOKEN}`];
  const body = JSON.stringify({ slug: "t1", name: "T", definition: { include: ["github.com/acme/app"] } });
  assert.equal((await call("GET", "/products", auth)).status, 200);
  assert.equal((await call("POST", "/products", auth, body)).status, 201);
  assert.equal((await call("GET", "/products/t1", auth)).status, 200);
  assert.equal((await call("PUT", "/products/t1", auth, JSON.stringify({ name: "T2", definition: {} }))).status, 200);
  assert.equal((await call("DELETE", "/products/t1", auth)).status, 204);
  assert.equal((await call("GET", "/nope", auth)).status, 404, "unmatched paths stay 404 once authenticated");
  assert.equal((await raw("GET", "/products", ["Authorization", `Bearer ${TOKEN}`, "host", "attacker.example"])).status, 403, "the Host check still applies");
});

test("the product listener neither needs nor reads the token", async () => {
  const url = `http://127.0.0.1:${port(product)}/mcp/core`;
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 200);
  assert.equal((await fetch(url, { method: "POST", body: "{}", headers: { authorization: "Bearer garbage" } })).status, 200);
  assert.equal((await fetch(url, { method: "POST", body: "{}", headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
});

test("ADMIN_TOKEN unset or empty: nothing listens on the admin port (real socket)", async () => {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const free = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  for (const env of [{ API_ADMIN_PORT: String(free) }, { API_ADMIN_PORT: String(free), ADMIN_TOKEN: "" }]) {
    assert.equal(await startAdmin(registry, env), undefined);
    const code = await new Promise<string>((resolve) => net.connect(free, "127.0.0.1").once("connect", function (this: net.Socket) { this.destroy(); resolve("connected"); }).once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error")));
    assert.equal(code, "ECONNREFUSED");
  }
});

test("a set ADMIN_TOKEN starts the listener and enforces it (real socket)", async () => {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const free = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const app = await startAdmin(registry, { API_ADMIN_PORT: String(free), ADMIN_TOKEN: TOKEN });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${free}/products`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${free}/products`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
  } finally { await app?.close(); }
});

test("a token shorter than 32 characters refuses to start, and the error does not contain it", async () => {
  const short = "Zq9-" + "k".repeat(28);
  assert.equal(short.length, 32);
  for (const bad of ["Zq9", "Zq9" + " ".repeat(5), "Zq9-" + "k".repeat(27), short.slice(1)]) {
    assert.throws(() => adminToken({ ADMIN_TOKEN: bad }), (e: Error) => !e.message.includes("Zq9") && /at least 32/.test(e.message));
    await assert.rejects(startAdmin(registry, { ADMIN_TOKEN: bad, API_ADMIN_PORT: "0" }), /at least 32/);
  }
  assert.equal(adminToken({ ADMIN_TOKEN: short }), short);
  assert.equal(adminToken({}), undefined);
});

test("the token never appears in a response or in anything written to stdout or stderr", async () => {
  await call("GET", "/products", ["authorization", `Bearer ${TOKEN}`]);
  const bodies = [...(await Promise.all(BAD.map(([, a]) => call("GET", "/products", a)))).map((r) => JSON.stringify(r)), JSON.stringify(await call("GET", "/products", ["authorization", `Bearer ${TOKEN}`]))];
  for (const b of bodies) assert.equal(b.includes(TOKEN), false);
  assert.equal(captured.join("").includes(TOKEN), false);
});

test("compose passes ADMIN_TOKEN through to the api service only", async () => {
  const { readFileSync } = await import("node:fs");
  const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
  assert.equal(compose.match(/ADMIN_TOKEN: \$\{ADMIN_TOKEN:-\}/g)?.length, 1);
  const api = compose.slice(compose.indexOf("\n  api:"));
  assert.match(api, /ADMIN_TOKEN: \$\{ADMIN_TOKEN:-\}/);
  assert.match(api, /127\.0\.0\.1:3002:3002/);
});

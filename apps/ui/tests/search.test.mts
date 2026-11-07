import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, before, after } from "node:test";

const seen: { url?: string; authorization?: string }[] = [];
let reply = { status: 200, body: {} as unknown };
const engine = http.createServer((req, res) => {
  seen.push({ url: req.url, authorization: req.headers.authorization });
  res
    .writeHead(reply.status, { "content-type": "application/json" })
    .end(JSON.stringify(reply.body));
});
before(
  () => new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve)),
);
after(() => engine.close());

const route = await import("../src/app/api/products/[productId]/search/route");
const ctx = { params: Promise.resolve({ productId: "alpha" }) };
const get = (query: string) =>
  route.GET(
    new Request(`http://localhost/api/products/alpha/search${query}`),
    ctx,
  );

test("search GET without ENGINE_URL answers 503, never mock data", async () => {
  delete process.env.ENGINE_URL;
  const res = await get("?q=x");
  assert.equal(res.status, 503);
  assert.match(await res.text(), /ENGINE_URL is not set/);
});

test("search GET forwards the query string to the Product's engine route with the admin bearer", async () => {
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  process.env.ENGINE_ADMIN_TOKEN = "admin-token-for-test";
  const body = {
    files: [],
    fileCount: 0,
    matchCount: 0,
    durationMs: 1,
    isSearchExhaustive: true,
  };
  reply = { status: 200, body };
  const res = await get("?q=foo+bar&regex=1&case=0");
  assert.deepEqual(await res.json(), body);
  assert.deepEqual(seen.at(-1), {
    url: "/ui/products/alpha/search?q=foo+bar&regex=1&case=0",
    authorization: "Bearer admin-token-for-test",
  });
});

test("a query syntax error reaches the page as { error } with the engine's message", async () => {
  reply = {
    status: 400,
    body: {
      statusCode: 400,
      errorCode: "FAILED_TO_PARSE_QUERY",
      message: "Failed to parse query",
    },
  };
  const res = await get("?q=file%3A");
  assert.deepEqual(
    [res.status, await res.json()],
    [400, { error: "Failed to parse query" }],
  );
});

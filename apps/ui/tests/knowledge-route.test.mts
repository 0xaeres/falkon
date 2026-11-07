import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, before, after } from "node:test";

const seen: {
  url?: string;
  method?: string;
  body: string;
  authorization?: string;
}[] = [];
let reply = { status: 201, body: {} as unknown };
const engine = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  seen.push({
    url: req.url,
    method: req.method,
    body,
    authorization: req.headers.authorization,
  });
  res
    .writeHead(reply.status, { "content-type": "application/json" })
    .end(JSON.stringify(reply.body));
});
before(
  () => new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve)),
);
after(() => engine.close());

const route =
  await import("../src/app/api/products/[productId]/knowledge/route");
const ctx = { params: Promise.resolve({ productId: "alpha" }) };
const post = (body: unknown) =>
  route.POST(
    new Request("http://localhost/api/products/alpha/knowledge", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    ctx,
  );

test("knowledge POST without ENGINE_URL answers 503, never mock data", async () => {
  delete process.env.ENGINE_URL;
  const res = await post({ repo: "github.com/a/b", action: "scan" });
  assert.equal(res.status, 503);
  assert.match(await res.text(), /ENGINE_URL is not set/);
});

test("knowledge POST forwards the action to the Product's engine route with the admin bearer", async () => {
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  process.env.ENGINE_ADMIN_TOKEN = "admin-token-for-test";
  reply = { status: 201, body: { ok: 1 } };
  const res = await post({ repo: "github.com/a/b", action: "delete" });
  assert.deepEqual(await res.json(), { ok: 1 });
  const last = seen.at(-1)!;
  assert.deepEqual(
    [last.url, last.method, last.authorization],
    ["/ui/products/alpha/knowledge", "POST", "Bearer admin-token-for-test"],
  );
  assert.deepEqual(JSON.parse(last.body), {
    repo: "github.com/a/b",
    action: "delete",
  });
});

test("a bad action never reaches the engine", async () => {
  const before = seen.length;
  const res = await post({ repo: "github.com/a/b", action: "drop" });
  assert.equal(res.status, 400);
  assert.equal(seen.length, before);
});

test("an engine refusal reaches the page as { error } with the engine's message", async () => {
  reply = {
    status: 404,
    body: {
      statusCode: 404,
      errorCode: "NOT_FOUND",
      message: "Repository not found.",
    },
  };
  const res = await post({ repo: "github.com/x/y", action: "scan" });
  assert.deepEqual(
    [res.status, await res.json()],
    [404, { error: "Repository not found." }],
  );
});

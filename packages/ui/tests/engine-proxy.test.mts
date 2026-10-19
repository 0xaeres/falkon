import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, before, after } from "node:test";

const seen: {
  method?: string;
  url?: string;
  authorization?: string;
  body: string;
}[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: [] };
const engine = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  seen.push({
    method: req.method,
    url: req.url,
    authorization: req.headers.authorization,
    body,
  });
  res
    .writeHead(reply.status, { "content-type": "application/json" })
    .end(JSON.stringify(reply.body));
});
before(
  () => new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve)),
);
after(() => engine.close());

const connections = await import("../src/app/api/connections/route");
const repositories = await import("../src/app/api/repositories/route");
const post = (value: unknown) =>
  new Request("http://localhost/api/connections", {
    method: "POST",
    body: JSON.stringify(value),
  });
const input = {
  provider: "github",
  method: "token",
  host: "https://github.com",
  token: "ghp_demo",
};

test("with ENGINE_URL set, connections POST is forwarded with the server-side admin bearer", async () => {
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  process.env.ENGINE_ADMIN_TOKEN = "admin-token-for-test";
  reply = {
    status: 201,
    body: {
      id: "c1",
      host: "github.com",
      provider: "github",
      createdAt: "2026-10-20T10:00:00.000Z",
      lastCheckedAt: null,
      status: "ok",
      scopes: [],
    },
  };
  const res = await connections.POST(post(input));
  assert.equal(res.status, 201);
  assert.equal(((await res.json()) as { id: string }).id, "c1");
  const call = seen.at(-1)!;
  assert.deepEqual(
    [call.method, call.url, call.authorization],
    ["POST", "/connections", "Bearer admin-token-for-test"],
  );
  assert.deepEqual(JSON.parse(call.body), input);
});

test("engine errors become { error } with the engine's fixed message and status; the admin token never leaks", async () => {
  reply = {
    status: 422,
    body: {
      statusCode: 422,
      errorCode: "INVALID_TOKEN",
      message: "The code host rejected this token.",
    },
  };
  const res = await connections.POST(post(input));
  assert.deepEqual(
    [res.status, await res.json()],
    [422, { error: "The code host rejected this token." }],
  );
  const before = seen.length;
  const bad = await connections.POST(post({ ...input, method: "app" }));
  assert.equal(bad.status, 400);
  assert.equal(seen.length, before, "an invalid body is not forwarded");
  process.env.ENGINE_URL = "http://127.0.0.1:1";
  const down = await connections.POST(post(input));
  assert.deepEqual(
    [down.status, await down.json()],
    [502, { error: "Falkon is unavailable. Try again." }],
  );
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
});

test("repositories GET maps connection, q and page to the engine route", async () => {
  reply = { status: 200, body: [] };
  const res = await repositories.GET(
    new Request(
      "http://localhost/api/repositories?connection=abc_-123&q=app+x&page=2",
    ),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(
    [seen.at(-1)!.method, seen.at(-1)!.url],
    ["GET", "/connections/abc_-123/repositories?q=app+x&page=2"],
  );
  for (const url of ["?q=x", "?connection=a&page=9", "?connection=a&other=1"])
    assert.equal(
      (
        await repositories.GET(
          new Request(`http://localhost/api/repositories${url}`),
        )
      ).status,
      400,
      url,
    );
});

test("with ENGINE_URL unset the mock answers", async () => {
  delete process.env.ENGINE_URL;
  const before = seen.length;
  const res = await repositories.GET(
    new Request("http://localhost/api/repositories?connection=x"),
  );
  assert.equal(res.status, 200);
  assert.ok(((await res.json()) as unknown[]).length > 0);
  assert.equal(seen.length, before);
});

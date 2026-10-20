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

const products = await import("../src/app/api/products/route");
const product = await import("../src/app/api/products/[productId]/route");
const status = await import("../src/app/api/products/[productId]/status/route");
const sync = await import("../src/app/api/products/[productId]/sync/route");
const threads =
  await import("../src/app/api/products/[productId]/threads/route");
const ctx = (productId: string) => ({ params: Promise.resolve({ productId }) });
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/x", { method, body: JSON.stringify(body) });
const setup = {
  id: "alpha",
  name: "Alpha",
  provider: "github",
  host: "github.com",
  connectionId: "conn1",
  repositories: [{ id: "github.com/acme/app", branch: "main" }],
};

test("product routes forward to /ui/products with the server-side bearer", async () => {
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  process.env.ENGINE_ADMIN_TOKEN = "admin-token-for-test";
  reply = { status: 200, body: [] };
  const get = () => new Request("http://localhost/api/x");
  const calls: [Response, string, string][] = [
    [await products.GET(), "GET", "/ui/products"],
    [await products.POST(json(setup)), "POST", "/ui/products"],
    [await product.GET(get(), ctx("alpha")), "GET", "/ui/products/alpha"],
    [
      await product.PATCH(
        json({ name: "A", repositories: setup.repositories }, "PATCH"),
        ctx("alpha"),
      ),
      "PATCH",
      "/ui/products/alpha",
    ],
    [await status.GET(get(), ctx("alpha")), "GET", "/ui/products/alpha/status"],
    [
      await sync.POST(json({ action: "retry" }), ctx("alpha")),
      "POST",
      "/ui/products/alpha/sync",
    ],
  ];
  const seenCalls = seen.slice(-6);
  calls.forEach(([res, method, url], i) => {
    assert.equal(res.status, 200, url);
    assert.deepEqual([seenCalls[i]!.method, seenCalls[i]!.url], [method, url]);
    assert.equal(seenCalls[i]!.authorization, "Bearer admin-token-for-test");
  });
  assert.deepEqual(JSON.parse(seenCalls[3]!.body), {
    name: "A",
    repositories: setup.repositories,
  });
});

test("product bodies are validated before forwarding", async () => {
  const before = seen.length;
  assert.equal(
    (await products.POST(json({ ...setup, connectionId: "" }))).status,
    400,
  );
  assert.equal(
    (
      await product.PATCH(
        json({ name: "A", repositories: [] }, "PATCH"),
        ctx("alpha"),
      )
    ).status,
    400,
  );
  assert.equal(
    (await sync.POST(json({ action: "dismiss" }), ctx("alpha"))).status,
    400,
  );
  assert.equal(seen.length, before);
});

const threadCtx = (productId: string, threadId: string) => ({
  params: Promise.resolve({ productId, threadId }),
});
const threadRoute =
  await import("../src/app/api/products/[productId]/threads/[threadId]/route");
const messages =
  await import("../src/app/api/products/[productId]/threads/[threadId]/messages/route");

test("thread routes forward to /ui/products/:slug/threads in engine mode", async () => {
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  reply = { status: 200, body: [] };
  const get = () => new Request("http://localhost/api/x");
  const before = seen.length;
  await threads.GET(get(), ctx("alpha"));
  await threads.POST(json({}), ctx("alpha"));
  await threadRoute.GET(get(), threadCtx("alpha", "t 1"));
  assert.deepEqual(
    seen.slice(before).map((c) => [c.method, c.url]),
    [
      ["GET", "/ui/products/alpha/threads"],
      ["POST", "/ui/products/alpha/threads"],
      ["GET", "/ui/products/alpha/threads/t%201"],
    ],
  );
  delete process.env.ENGINE_URL;
  assert.equal((await threads.GET(get(), ctx("engine-made"))).status, 404);
});

test("chat messages: 503 without the engine; the engine's stream passes through unbuffered; its errors become { error }", async () => {
  delete process.env.ENGINE_URL;
  assert.equal(
    (await messages.POST(json({ text: "hi" }), threadCtx("alpha", "t1")))
      .status,
    503,
  );

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let engineSaw: { url?: string; authorization?: string; body: string } = {
    body: "",
  };
  const streaming = http.createServer(async (req, res) => {
    for await (const chunk of req) engineSaw.body += chunk;
    engineSaw = {
      ...engineSaw,
      url: req.url,
      authorization: req.headers.authorization,
    };
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    });
    res.write("data: one\n\n");
    await gate;
    res.write("data: two\n\n");
    res.end();
  });
  await new Promise<void>((r) => streaming.listen(0, "127.0.0.1", r));
  try {
    process.env.ENGINE_URL = `http://127.0.0.1:${(streaming.address() as AddressInfo).port}`;
    const res = await messages.POST(
      json({ text: "hi there" }),
      threadCtx("alpha", "t1"),
    );
    assert.deepEqual(
      [
        res.status,
        res.headers.get("content-type"),
        res.headers.get("x-vercel-ai-ui-message-stream"),
      ],
      [200, "text/event-stream", "v1"],
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    assert.equal(
      first,
      "data: one\n\n",
      "the first chunk arrives while the engine is still working",
    );
    release();
    let rest = "";
    for (let r = await reader.read(); !r.done; r = await reader.read())
      rest += decoder.decode(r.value);
    assert.equal(rest, "data: two\n\n");
    assert.deepEqual(
      [engineSaw.url, engineSaw.authorization, JSON.parse(engineSaw.body)],
      [
        "/ui/products/alpha/threads/t1/messages",
        "Bearer admin-token-for-test",
        { text: "hi there" },
      ],
    );
  } finally {
    streaming.closeAllConnections();
    streaming.close();
  }

  // A history, an unknown key or an empty question never reaches the engine.
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  const count = seen.length;
  for (const bad of [
    { text: "x", messages: [] },
    { text: " " },
    { text: "x", extra: 1 },
    {},
  ])
    assert.equal(
      (await messages.POST(json(bad), threadCtx("alpha", "t1"))).status,
      400,
    );
  assert.equal(seen.length, count);

  reply = {
    status: 409,
    body: {
      statusCode: 409,
      errorCode: "NO_GENERATION",
      message: "Chat opens when the first Evidence Generation publishes.",
    },
  };
  const conflict = await messages.POST(
    json({ text: "hi" }),
    threadCtx("alpha", "t1"),
  );
  assert.deepEqual(
    [conflict.status, await conflict.json()],
    [
      409,
      { error: "Chat opens when the first Evidence Generation publishes." },
    ],
  );
  delete process.env.ENGINE_URL;
});

test("a client that goes away aborts the engine call", async () => {
  let closed!: () => void;
  const gone = new Promise<void>((r) => (closed = r));
  const hanging = http.createServer((req, res) => {
    res.on("close", closed);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: start\n\n");
  });
  await new Promise<void>((r) => hanging.listen(0, "127.0.0.1", r));
  try {
    process.env.ENGINE_URL = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`;
    const abort = new AbortController();
    const res = await messages.POST(
      new Request("http://localhost/api/x", {
        method: "POST",
        body: JSON.stringify({ text: "hi" }),
        signal: abort.signal,
      }),
      threadCtx("alpha", "t1"),
    );
    await res.body!.getReader().read();
    abort.abort();
    await gone;
  } finally {
    delete process.env.ENGINE_URL;
    hanging.closeAllConnections();
    hanging.close();
  }
});

const productBody = {
  id: "fixtures",
  name: "fixtures",
  initials: "F",
  provider: "github",
  host: "fixtures.test",
  repositories: [],
  activeGeneration: null,
  scenario: "building",
  queuedAt: null,
};

test("server pages read Products from the engine: list, one, and not found as null", async () => {
  const { engineProduct, engineProducts } = await import("../src/lib/api/engine");
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  reply = { status: 200, body: [productBody] };
  assert.equal((await engineProducts())[0]?.id, "fixtures");
  reply = { status: 200, body: productBody };
  assert.equal((await engineProduct("fixtures"))?.id, "fixtures");
  assert.equal(seen.at(-1)?.url, "/ui/products/fixtures");
  reply = { status: 404, body: { message: "Product not found." } };
  assert.equal(await engineProduct("nope"), null);
});

test("without ENGINE_ADMIN_TOKEN the bearer is read from the admin.token file per request, so a rotation needs no restart", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, renameSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ui-admin-token-"));
  mkdirSync(join(dir, "secrets"));
  const file = join(dir, "secrets", "admin.token");
  process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
  delete process.env.ENGINE_ADMIN_TOKEN;
  process.env.DATA_DIR = dir;
  reply = { status: 200, body: [] };
  const bearer = async () => {
    await products.GET();
    return seen.at(-1)!.authorization;
  };
  writeFileSync(file, "a".repeat(64));
  assert.equal(await bearer(), `Bearer ${"a".repeat(64)}`);
  writeFileSync(`${file}.new`, "b".repeat(64));
  renameSync(`${file}.new`, file);
  assert.equal(await bearer(), `Bearer ${"b".repeat(64)}`);
  process.env.ENGINE_ADMIN_TOKEN = "env-wins";
  assert.equal(await bearer(), "Bearer env-wins");
  delete process.env.ENGINE_ADMIN_TOKEN;
  delete process.env.DATA_DIR;
});

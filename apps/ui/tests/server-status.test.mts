import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { engineStatus } from "../src/lib/api/server";
import { makeStatus, seedProducts } from "./mock-fixtures";

const status = makeStatus(seedProducts[0]);
let seen: { url?: string; auth?: string } = {};
async function engine(
  handler: Parameters<typeof createServer>[1],
  run: () => Promise<void>,
) {
  const server: Server = createServer((req, res) => {
    seen = { url: req.url, auth: req.headers.authorization };
    handler!(req, res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ENGINE_ADMIN_TOKEN = "t0ken";
  try {
    await run();
  } finally {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
}
const json = (body: unknown): Parameters<typeof createServer>[1] => (_req, res) =>
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));

test("engineStatus returns the engine's status, asking with the admin token on the product path", () =>
  engine(json(status), async () => {
    assert.deepEqual(await engineStatus("payments-platform"), status);
    assert.equal(seen.url, "/ui/products/payments-platform/status");
    assert.equal(seen.auth, "Bearer t0ken");
  }));

test("engineStatus is undefined when the engine is down, errors, or answers something that is not a status", async () => {
  process.env.ENGINE_URL = "http://127.0.0.1:1"; // refused
  assert.equal(await engineStatus("x"), undefined);
  await engine((_q, res) => res.writeHead(502).end("{}"), async () =>
    assert.equal(await engineStatus("x"), undefined));
  await engine((_q, res) => res.writeHead(404).end("{}"), async () =>
    assert.equal(await engineStatus("x"), undefined));
  await engine(json({ nope: 1 }), async () =>
    assert.equal(await engineStatus("x"), undefined));
  await engine((_q, res) => res.writeHead(200).end("{not json"), async () =>
    assert.equal(await engineStatus("x"), undefined));
});

test("engineStatus gives up after the timeout when the engine hangs", () =>
  engine(() => {}, async () => {
    const start = Date.now();
    assert.equal(await engineStatus("x", 50), undefined);
    assert.ok(Date.now() - start < 2000);
  }));

test("engineStatus timeout covers the body read: headers sent, body dripped slowly", () =>
  engine(
    (_q, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("{");
      const timer = setInterval(() => res.write(" "), 20);
      res.on("close", () => clearInterval(timer));
    },
    async () => {
      const start = Date.now();
      assert.equal(await engineStatus("x", 100), undefined);
      assert.ok(Date.now() - start < 1500);
    },
  ));

test("engineStatus stops reading an unbounded response", () =>
  engine(
    (_q, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const chunk = Buffer.alloc(64 * 1024, "a");
      const timer = setInterval(() => res.write(chunk), 1);
      res.on("close", () => clearInterval(timer));
    },
    async () => {
      assert.equal(await engineStatus("x"), undefined);
    },
  ));

test("engineStatus without ENGINE_URL is undefined", async () => {
  delete process.env.ENGINE_URL;
  assert.equal(await engineStatus("x"), undefined);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

delete process.env.ENGINE_URL;
const ctx = { params: Promise.resolve({ productId: "alpha" }) };
const get = () => new Request("http://localhost/api/x");

test("UI routes without ENGINE_URL answer 503 'ENGINE_URL is not set', never mock data", async () => {
  const products = await import("../src/app/api/products/route");
  const status =
    await import("../src/app/api/products/[productId]/status/route");
  const repositories = await import("../src/app/api/repositories/route");
  const connections = await import("../src/app/api/connections/route");
  const calls = [
    products.GET(),
    status.GET(get(), ctx),
    repositories.GET(
      new Request("http://localhost/api/repositories?connection=c1"),
    ),
    connections.POST(
      new Request("http://localhost/api/connections", {
        method: "POST",
        body: JSON.stringify({
          provider: "github",
          method: "token",
          host: "https://github.com",
          token: "t",
        }),
      }),
    ),
  ];
  for (const res of await Promise.all(calls)) {
    assert.equal(res.status, 503);
    assert.match(await res.text(), /ENGINE_URL is not set/);
  }
});

test("no module under src imports mock data", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  const offenders = walk(new URL("../src", import.meta.url).pathname).filter(
    (f) => /\bmock\//.test(readFileSync(f, "utf8")),
  );
  assert.deepEqual(offenders, []);
});

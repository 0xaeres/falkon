import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// ENGINE_URL is runtime config: a GET that never awaits connection() is prerendered at `next build` with the mock answer.
// ponytail: source check, not a build check; a build-output check (no .next/server/app/api/*.body) if this regresses again.
for (const path of ["repositories", "products", "connections/[connectionId]/repositories/[org]/[name]/branches"])
  test(`GET /api/${path} awaits connection()`, async () => {
    const source = await readFile(new URL(`../src/app/api/${path}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /export async function GET[^{]*\{\s*await \w+\(\);/);
  });

test("branches route refuses an empty, over-long, . or .. path segment with 400", async () => {
  const { GET } = await import("../src/app/api/connections/[connectionId]/repositories/[org]/[name]/branches/route");
  const call = ([connectionId, org, name]: readonly [string, string, string]) =>
    GET(new Request("http://x/"), { params: Promise.resolve({ connectionId, org, name }) });
  for (const bad of ["", "..", ".", "x".repeat(101)]) {
    for (const args of [[bad, "o", "n"], ["c", bad, "n"], ["c", "o", bad]] as const)
      assert.equal((await call(args)).status, 400, JSON.stringify(args));
  }
  // a valid triple passes validation and reaches the engine call (ENGINE_URL unset: 503)
  assert.equal((await call(["c", "o", "n"])).status, 503);
});

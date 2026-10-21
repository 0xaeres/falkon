import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// ENGINE_URL is runtime config: a GET that never awaits connection() is prerendered at `next build` with the mock answer.
// ponytail: source check, not a build check; a build-output check (no .next/server/app/api/*.body) if this regresses again.
for (const path of ["repositories", "products"])
  test(`GET /api/${path} awaits connection()`, async () => {
    const source = await readFile(new URL(`../src/app/api/${path}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /export async function GET[^{]*\{\s*await \w+\(\);/);
  });

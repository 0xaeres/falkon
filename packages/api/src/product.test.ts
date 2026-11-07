import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@falkon/db";
import { fakeProductTable } from "../../backend/src/productTable.fake";
import { isProductName, PrismaProductRegistry } from "./product";

test("product names must match ^[a-z0-9][a-z0-9-]{0,62}$", () => {
  for (const ok of ["a", "0", "core", "a-b-c", "a".repeat(63)]) assert.equal(isProductName(ok), true, ok);
  for (const bad of ["", "-a", "A", "a_b", "a.b", "a/b", "a b", "a\n", "a".repeat(64), "..", "é", "__proto__", "cоре"]) assert.equal(isProductName(bad), false, JSON.stringify(bad));
});

test("reads are fresh: find returns what the table holds now", async () => {
  const product = fakeProductTable([{ slug: "core", source: "api", name: "core", definition: {}, repoNames: ["a"] }]);
  const registry = new PrismaProductRegistry({ product } as unknown as Pick<PrismaClient, "product">);
  assert.deepEqual((await registry.find("core"))?.repoNames, ["a"]);
  product.rows[0]!.repoNames = ["a", "b"];
  assert.deepEqual((await registry.find("core"))?.repoNames, ["a", "b"]);
  for (const name of ["missing", "constructor", "__proto__"]) assert.equal(await registry.find(name), undefined);
});

test("the registry only reads: no write methods exist", () => {
  const registry = new PrismaProductRegistry({} as never);
  for (const m of ["create", "update", "remove", "list", "get"]) assert.equal((registry as unknown as Record<string, unknown>)[m], undefined, m);
});

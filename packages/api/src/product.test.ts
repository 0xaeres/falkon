import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextProductResolver, isProductName } from "./product";

const resolver = new ContextProductResolver(async () => ({ core: ["a/one", "a/two"], empty: [] }));

test("resolves a product to its repo names", async () => {
  assert.deepEqual(await resolver.repoNames("core"), ["a/one", "a/two"]);
  assert.deepEqual(await resolver.repoNames("empty"), []);
});

test("an unknown product resolves to undefined, including names inherited from Object.prototype", async () => {
  for (const name of ["missing", "constructor", "toString", "__proto__"]) assert.equal(await resolver.repoNames(name), undefined);
});

test("product names must match ^[a-z0-9][a-z0-9-]{0,62}$", () => {
  for (const ok of ["a", "0", "core", "a-b-c", "a".repeat(63)]) assert.equal(isProductName(ok), true, ok);
  for (const bad of ["", "-a", "A", "a_b", "a.b", "a/b", "a b", "a\n", "a".repeat(64), "..", "é"]) assert.equal(isProductName(bad), false, JSON.stringify(bad));
});

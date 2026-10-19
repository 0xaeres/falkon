import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakeDb";
import { isProductName, PrismaProductRegistry } from "./product";

test("product names must match ^[a-z0-9][a-z0-9-]{0,62}$", () => {
  for (const ok of ["a", "0", "core", "a-b-c", "a".repeat(63)]) assert.equal(isProductName(ok), true, ok);
  for (const bad of ["", "-a", "A", "a_b", "a.b", "a/b", "a b", "a\n", "a".repeat(64), "..", "é", "__proto__", "cоre"]) assert.equal(isProductName(bad), false, JSON.stringify(bad));
});

test("create resolves the definition against Repo rows at write time and stores an api Product", async () => {
  const { db } = fakeDb();
  const registry = new PrismaProductRegistry(db);
  const created = await registry.create("mine", { name: "Mine", definition: { include: ["github.com/acme/*"], includeConnections: ["other"], exclude: ["**/lib"] } });
  assert.notEqual(created, "conflict");
  assert.deepEqual(created !== "conflict" && [created.slug, created.source, created.name, created.description, created.repoNames], ["mine", "api", "Mine", null, ["github.com/acme/app", "github.com/other/tool"]]);
  assert.equal("id" in (created as object), false, "the internal id is not shown");
  assert.deepEqual(await registry.find("mine").then((p) => p?.repoNames), ["github.com/acme/app", "github.com/other/tool"]);
  assert.equal(await registry.create("mine", { name: "Again", definition: {} }), "conflict");
});

test("reads are fresh: find returns what the table holds now", async () => {
  const { db, rows } = fakeDb([{ slug: "core", source: "config", name: "core", definition: {}, repoNames: ["a"] }]);
  const registry = new PrismaProductRegistry(db);
  assert.deepEqual((await registry.find("core"))?.repoNames, ["a"]);
  rows[0]!.repoNames = ["a", "b"];
  assert.deepEqual((await registry.find("core"))?.repoNames, ["a", "b"]);
  for (const name of ["missing", "constructor", "__proto__"]) assert.equal(await registry.find(name), undefined);
});

test("config Products are read-only: update and remove are conflicts and change nothing; a config slug cannot be created", async () => {
  const { db, rows } = fakeDb([{ slug: "core", source: "config", name: "core", definition: { include: ["a"] }, repoNames: ["a"] }]);
  const registry = new PrismaProductRegistry(db);
  const before = structuredClone(rows);
  assert.equal(await registry.update("core", { name: "x", definition: { include: ["**"] } }), "conflict");
  assert.equal(await registry.remove("core"), "conflict");
  assert.equal(await registry.create("core", { name: "x", definition: {} }), "conflict");
  assert.deepEqual(rows, before);
});

test("update re-resolves membership and keeps slug, source and id; remove deletes; unknown slugs are not-found", async () => {
  const { db, rows, setRepos } = fakeDb();
  const registry = new PrismaProductRegistry(db);
  await registry.create("mine", { name: "Mine", description: "d", definition: { include: ["github.com/acme/app"] } });
  const id = rows[0]!.id;
  setRepos(["github.com/acme/app", "github.com/acme/new"]);
  const updated = await registry.update("mine", { name: "Renamed", definition: { include: ["github.com/acme/*"] } });
  assert.deepEqual(updated !== "conflict" && updated !== "not-found" && [updated.slug, updated.source, updated.name, updated.description, updated.repoNames], ["mine", "api", "Renamed", null, ["github.com/acme/app", "github.com/acme/new"]]);
  assert.equal(rows[0]!.id, id);
  assert.equal(await registry.update("nope", { name: "x", definition: {} }), "not-found");
  assert.equal(await registry.remove("nope"), "not-found");
  assert.equal(await registry.remove("mine"), "ok");
  assert.equal(await registry.get("mine"), undefined);
});

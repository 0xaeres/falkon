import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authenticate, scopeFor, type AccessKey } from "./access";

const sha = (k: string) => createHash("sha256").update(k).digest("hex");
const keys: AccessKey[] = [
  { name: "o3", sha256: sha("o3-key"), repos: ["github.com/openmrs/*"] },
  { name: "one", sha256: sha("one-key"), repos: ["github.com/acme/app"] },
];

test("exact names and trailing-star prefixes", () => {
  const s = scopeFor(["github.com/acme/app", "github.com/openmrs/*"]);
  assert.ok(s.allows("github.com/acme/app"));
  assert.ok(s.allows("github.com/openmrs/openmrs-core"));
  assert.ok(!s.allows("github.com/acme/app2"));
  assert.ok(!s.allows("github.com/acme"));
  assert.ok(!s.allows("xgithub.com/openmrs/core"));
});

test("a star alone allows everything and adds no zoekt filter", () => {
  const s = scopeFor(["*"]);
  assert.ok(s.allows("anything"));
  assert.equal(s.zoektFilter, null);
});

test("an empty allowlist allows nothing", () => {
  const s = scopeFor([]);
  assert.ok(!s.allows("github.com/acme/app"));
});

test("zoekt filter is an anchored regex over the allowlist with metacharacters escaped", () => {
  const s = scopeFor(["github.com/acme/app.v2", "github.com/openmrs/*"]);
  assert.equal(s.zoektFilter, "repo:^(?:github\\x2ecom/acme/app\\x2ev2|github\\x2ecom/openmrs/.*)$");
  assert.ok(!/\s/.test(s.zoektFilter!));
});

test("authenticate resolves a key to its scope, rejects unknown, empty and near-miss keys", () => {
  assert.ok(authenticate("o3-key", keys)?.allows("github.com/openmrs/x"));
  assert.ok(!authenticate("o3-key", keys)?.allows("github.com/acme/app"));
  assert.ok(authenticate("one-key", keys)?.allows("github.com/acme/app"));
  assert.equal(authenticate("o3-key ", keys), null);
  assert.equal(authenticate("", keys), null);
  assert.equal(authenticate(undefined, keys), null);
});

test("the legacy single key grants full access; with no keys at all access is open", () => {
  assert.ok(authenticate("legacy", [], "legacy")?.allows("any"));
  assert.equal(authenticate("wrong", [], "legacy"), null);
  assert.ok(authenticate(undefined, [], undefined)?.allows("any"));
});

test("configured keys with no presented key are rejected even without a legacy key", () => {
  assert.equal(authenticate(undefined, keys), null);
});

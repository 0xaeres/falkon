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

test("a star alone allows everything and adds no repo filter", () => {
  const s = scopeFor(["*"]);
  assert.ok(s.allows("anything"));
  assert.equal(s.repoFilter, null);
});

test("an empty allowlist allows nothing", () => {
  const s = scopeFor([]);
  assert.ok(!s.allows("github.com/acme/app"));
});

test("repo filter is an anchored regex over the allowlist with metacharacters escaped", () => {
  const s = scopeFor(["github.com/acme/app.v2", "github.com/openmrs/*"]);
  assert.equal(s.repoFilter, "^(?:github\\x2ecom/acme/app\\x2ev2(?:::knowledge)?|github\\x2ecom/openmrs/.*)$");
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

test("a configured access file with no keys denies everyone instead of opening access", () => {
  assert.equal(authenticate("anything", [], undefined, true), null);
  assert.equal(authenticate(undefined, [], undefined, true), null);
  // the legacy key still works as an admin key
  assert.ok(authenticate("legacy", [], "legacy", true)?.allows("any"));
});

test("loadAccessKeys throws on a missing file rather than returning no keys", async () => {
  const { loadAccessKeys } = await import("./access");
  assert.throws(() => loadAccessKeys("/nonexistent/keys.json"));
  assert.deepEqual(loadAccessKeys(undefined), []);
});

test("repo directory names are collision-free", async () => {
  const { repoDirName } = await import("./env");
  assert.notEqual(repoDirName("github.com/acme/app"), repoDirName("github.com_2Facme_2Fapp"));
  assert.notEqual(repoDirName("a_b"), repoDirName("a/b"));
  assert.equal(repoDirName("x"), "x");
});

test("a knowledge base is visible exactly when its owner repo is", () => {
  const s = scopeFor(["github.com/acme/app", "github.com/openmrs/*"]);
  assert.ok(s.allows("github.com/acme/app::knowledge"));
  assert.ok(s.allows("github.com/openmrs/core::knowledge"));
  assert.ok(!s.allows("github.com/acme/other::knowledge"));
  assert.ok(!s.allows("github.com/acme/app2::knowledge"));
  assert.ok(!s.allows("::knowledge"));
  const re = new RegExp(s.repoFilter!);
  assert.ok(re.test("github.com/acme/app::knowledge") && re.test("github.com/acme/app") && !re.test("github.com/acme/other::knowledge"));
});

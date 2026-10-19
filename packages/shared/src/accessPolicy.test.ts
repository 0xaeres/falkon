import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accessPolicyFromEnv, apiKeyAccessPolicy, noneAccessPolicy, scopeFingerprint } from "./accessPolicy";

const sha = (k: string) => createHash("sha256").update(k).digest("hex");
const PRODUCT = ["github.com/acme/app", "github.com/acme/lib", "github.com/other/tool"];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-policy-"));
const accessFile = (body: unknown) => {
  const file = path.join(dir, `${Math.random()}.json`);
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  return file;
};
const keysFile = accessFile({
  keys: [
    { name: "acme", sha256: sha("acme-key"), repos: ["github.com/acme/*"] },
    { name: "all", sha256: sha("all-key"), repos: ["*"] },
    { name: "outside", sha256: sha("outside-key"), repos: ["github.com/elsewhere/x"] },
  ],
});

test("none: every caller is the same stable principal and sees exactly the Product's repos", () => {
  const policy = noneAccessPolicy();
  for (const header of [undefined, "Bearer anything", "garbage"]) {
    const caller = policy.authenticate(header);
    assert.equal(caller?.principal, "anonymous");
    const eff = policy.effectiveScope(caller!, PRODUCT)!;
    assert.deepEqual(eff.repos, PRODUCT);
    assert.equal(eff.scope.principal, "anonymous");
    for (const r of PRODUCT) assert.ok(eff.scope.allows(r));
    assert.ok(!eff.scope.allows("github.com/acme/secret"));
    assert.notEqual(eff.scope.repoFilter, null, "a Product scope is never unrestricted");
  }
  assert.deepEqual(policy.effectiveScope(policy.authenticate(undefined)!, [])?.repos, [], "none serves an empty Product as empty, not as everything");
  assert.equal(policy.effectiveScope(policy.authenticate(undefined)!, [])!.scope.allows("x"), false);
});

test("apiKey: only `Authorization: Bearer <key>` authenticates; missing and bad keys are both null", () => {
  const policy = apiKeyAccessPolicy(keysFile);
  assert.equal(policy.authenticate("Bearer acme-key")?.principal, "key:acme");
  for (const header of [undefined, "", "Bearer", "Bearer ", "bearer acme-key", "Basic acme-key", "acme-key", "Bearer acme-key2", "Bearer  acme-key", "Token acme-key"]) {
    assert.equal(policy.authenticate(header), null, JSON.stringify(header));
  }
});

test("apiKey: the effective set is the Product's set intersected with the key; narrow never widens", () => {
  const policy = apiKeyAccessPolicy(keysFile);
  const acme = policy.effectiveScope(policy.authenticate("Bearer acme-key")!, PRODUCT)!;
  assert.deepEqual(acme.repos, ["github.com/acme/app", "github.com/acme/lib"]);
  assert.ok(!acme.scope.allows("github.com/other/tool"), "in the Product, outside the key");
  assert.ok(!acme.scope.allows("github.com/acme/secret"), "inside the key's prefix, outside the Product");
  assert.equal(acme.scope.principal, "key:acme");
  // A `*` key is still limited to the Product.
  const all = policy.effectiveScope(policy.authenticate("Bearer all-key")!, PRODUCT)!;
  assert.deepEqual(all.repos, PRODUCT);
  assert.ok(!all.scope.allows("github.com/acme/secret"));
  assert.notEqual(all.scope.repoFilter, null);
});

test("apiKey: an empty intersection is a denial (null), which the boundary answers like an unknown Product", () => {
  const policy = apiKeyAccessPolicy(keysFile);
  assert.equal(policy.effectiveScope(policy.authenticate("Bearer outside-key")!, PRODUCT), null);
  assert.equal(policy.effectiveScope(policy.authenticate("Bearer all-key")!, []), null);
});

test("Product repo names with a `*` never become prefix patterns", () => {
  const eff = noneAccessPolicy().effectiveScope(noneAccessPolicy().authenticate(undefined)!, ["*", "github.com/acme/*", "github.com/acme/app"])!;
  assert.deepEqual(eff.repos, ["github.com/acme/app"]);
  assert.ok(!eff.scope.allows("github.com/acme/other"));
  assert.ok(!eff.scope.allows("anything"));
});

test("apiKey fails closed: missing, unreadable, malformed or empty access files deny everyone", () => {
  for (const file of [undefined, path.join(dir, "missing.json"), accessFile("{not json"), accessFile({ keys: [{ name: "x" }] }), accessFile({ keys: [] }), dir]) {
    const policy = apiKeyAccessPolicy(file);
    for (const header of [undefined, "Bearer acme-key", "Bearer all-key"]) assert.equal(policy.authenticate(header), null, `${file} ${header}`);
  }
});

test("apiKey re-reads the access file when it changes, and a broken rewrite denies everyone", () => {
  const file = accessFile({ keys: [{ name: "a", sha256: sha("a-key"), repos: ["*"] }] });
  const policy = apiKeyAccessPolicy(file);
  assert.equal(policy.authenticate("Bearer a-key")?.principal, "key:a");
  fs.writeFileSync(file, JSON.stringify({ keys: [{ name: "b", sha256: sha("b-key"), repos: ["*"] }] }));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(policy.authenticate("Bearer a-key"), null);
  assert.equal(policy.authenticate("Bearer b-key")?.principal, "key:b");
  fs.writeFileSync(file, "broken");
  fs.utimesSync(file, new Date(), new Date(Date.now() + 10000));
  assert.equal(policy.authenticate("Bearer b-key"), null);
});

test("AUTH_MODE: unset is none, apiKey uses ACCESS_FILE, anything else refuses to start", () => {
  assert.equal(accessPolicyFromEnv({}).authenticate(undefined)?.principal, "anonymous");
  assert.equal(accessPolicyFromEnv({ AUTH_MODE: "none" }).authenticate(undefined)?.principal, "anonymous");
  assert.equal(accessPolicyFromEnv({ AUTH_MODE: "apiKey", ACCESS_FILE: keysFile }).authenticate("Bearer acme-key")?.principal, "key:acme");
  assert.equal(accessPolicyFromEnv({ AUTH_MODE: "apiKey" }).authenticate("Bearer acme-key"), null);
  for (const mode of ["", "None", "apikey", "APIKEY", "off", "true", " none"]) assert.throws(() => accessPolicyFromEnv({ AUTH_MODE: mode }), /AUTH_MODE/, mode);
});

test("the scope fingerprint is order-independent and separates distinct sets", () => {
  assert.equal(scopeFingerprint(["b", "a"]), scopeFingerprint(["a", "b"]));
  assert.notEqual(scopeFingerprint(["a", "b"]), scopeFingerprint(["a"]));
  assert.notEqual(scopeFingerprint(["a,b"]), scopeFingerprint(["a", "b"]));
  assert.match(scopeFingerprint([]), /^[0-9a-f]{64}$/);
});

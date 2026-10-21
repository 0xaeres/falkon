import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_SETTINGS, getTokenFromConfig, parseConfig, resolveEnvironmentOverrides, setCredentialResolver } from "./config";

test("the example config parses: Falkon format, comments, clone-only knowledgeBase", () => {
  const c = parseConfig(fs.readFileSync(new URL("../../../config.example.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(c.connections), ["github", "hello", "local"]);
  assert.equal(c.knowledgeBase.enabled, true);
  assert.equal(c.contexts.octocat?.include?.[0], "github.com/octocat/*");
});

test("knowledge base is on by default and can be switched off", () => {
  assert.equal(parseConfig("{}").knowledgeBase.enabled, true);
  assert.equal(parseConfig(JSON.stringify({ knowledgeBase: { enabled: false } })).knowledgeBase.enabled, false);
});

test("settings fall back to Falkon's defaults", () => {
  const c = parseConfig(JSON.stringify({ settings: { maxFileSize: 10 } }));
  assert.equal(c.settings.maxFileSize, 10);
  assert.equal(c.settings.maxTrigramCount, DEFAULT_SETTINGS.maxTrigramCount);
  assert.equal(c.settings.reindexIntervalMs, 3_600_000);
});

test("the schema rejects what Falkon rejects", () => {
  assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type: "github", bogus: 1 } } })), /invalid/);
  assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type: "git" } } })), /invalid/);
  assert.throws(() => parseConfig(JSON.stringify({ unknownTopLevel: true })), /invalid/);
});

test("tokens and environment overrides resolve from env", async () => {
  process.env.FALKON_TEST_TOKEN = "  secret \n";
  assert.equal(await getTokenFromConfig({ env: "FALKON_TEST_TOKEN" }), "secret");
  await assert.rejects(getTokenFromConfig({ env: "FALKON_TEST_MISSING" }), /not found/);
  const c = parseConfig(JSON.stringify({ environmentOverrides: { A: { type: "token", value: { env: "FALKON_TEST_TOKEN" } }, B: { type: "number", value: 3 } } }));
  assert.deepEqual(await resolveEnvironmentOverrides(c), { A: "secret", B: "3" });
});

test("a {stored} token is rejected in a config file and resolved through the injected resolver", async () => {
  assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type: "github", token: { stored: "abc" } } } })), /invalid/);
  assert.throws(() => parseConfig(JSON.stringify({ environmentOverrides: { A: { type: "token", value: { stored: "abc" } } } })), /invalid/);
  await assert.rejects(getTokenFromConfig({ stored: "abc" }), /No credential resolver/);
  setCredentialResolver(async (id) => `token-of-${id}`);
  assert.equal(await getTokenFromConfig({ stored: "abc" }), "token-of-abc");
});

test("an empty object parses to defaults", () => {
  const c = parseConfig("{}");
  assert.deepEqual(c.connections, {});
  assert.equal(c.settings.maxFileSize, DEFAULT_SETTINGS.maxFileSize);
});

test("JSONC comments and trailing commas parse; $schema is an ignored editor hint", () => {
  const c = parseConfig('{ // c\n "$schema": "anything", /* b */ "connections": { "a": { "type": "git", "url": "https://x.io/r.git", }, }, }');
  assert.deepEqual(Object.keys(c.connections), ["a"]);
});

test("an unknown key names itself in the error", () => {
  assert.throws(() => parseConfig(JSON.stringify({ unknownTopLevel: true })), /unknownTopLevel/);
  assert.doesNotThrow(() => parseConfig('{"$schema": 5}'));
  assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type: "github", bogus: 1 } } })), /bogus/);
  assert.throws(() => parseConfig(JSON.stringify({ knowledgeBase: { nope: 1 } })), /nope/);
});

test("unsupported connection types are rejected", () => {
  for (const type of ["gitlab", "gitea", "bitbucket", "azuredevops", "gerrit"]) {
    const m = new RegExp(`connection 'x': type '${type}' is not supported \\(supported: github, git\\).*convert-config`);
    assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type, url: "https://h.io" } } })), m, type);
  }
});

test("token forms {env} and {googleCloudSecret} validate", () => {
  const gcs = { googleCloudSecret: "projects/p/secrets/s/versions/1" };
  const c = parseConfig(JSON.stringify({ connections: { x: { type: "github", token: gcs }, y: { type: "github", token: { env: "T" } } } }));
  assert.deepEqual((c.connections.x as { token: unknown }).token, gcs);
});

test("a 5 MB config loads quickly", () => {
  const connections = Object.fromEntries(Array.from({ length: 25_000 }, (_, i) => [`c${i}`, { type: "github", repos: [`org/repo-${i}`], orgs: ["a".repeat(150)] }]));
  const text = JSON.stringify({ connections });
  assert.ok(text.length > 5_000_000);
  const t = Date.now();
  assert.equal(Object.keys(parseConfig(text).connections).length, 25_000);
  assert.ok(Date.now() - t < 10_000);
});

test("a model with an unsupported provider is named with the supported three", () => {
  assert.throws(() => parseConfig(JSON.stringify({ models: [{ provider: "mistral", model: "m" }] })), /'mistral'.*openai-compatible, openai, anthropic.*convert-config/);
  const ok = parseConfig(JSON.stringify({ models: [{ provider: "anthropic", model: "m", authToken: { env: "T" } }, { provider: "openai", model: "m" }, { provider: "openai-compatible", model: "m", baseUrl: "http://h/v1" }] }));
  assert.equal(ok.models?.length, 3);
});

test("a top level that is not an object is an invalid-config error", () => {
  for (const text of ["[]", "null", "5", '"x"']) assert.throws(() => parseConfig(text), /is invalid: must be a JSON object/, text);
});

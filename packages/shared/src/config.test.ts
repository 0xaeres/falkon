import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_SETTINGS, getTokenFromConfig, parseConfig, resolveEnvironmentOverrides, setCredentialResolver } from "./config";

test("the example config parses: v3 format, comments, clone-only knowledgeBase", () => {
  const c = parseConfig(fs.readFileSync(new URL("../../../config.example.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(c.connections), ["github", "hello", "local"]);
  assert.equal(c.knowledgeBase.enabled, true);
  assert.equal(c.contexts.web?.include?.[0], "github.com/sourcebot-dev/*");
});

test("knowledge base is on by default and can be switched off", () => {
  assert.equal(parseConfig("{}").knowledgeBase.enabled, true);
  assert.equal(parseConfig(JSON.stringify({ knowledgeBase: { enabled: false } })).knowledgeBase.enabled, false);
});

test("settings fall back to Sourcebot's defaults", () => {
  const c = parseConfig(JSON.stringify({ settings: { maxFileSize: 10 } }));
  assert.equal(c.settings.maxFileSize, 10);
  assert.equal(c.settings.maxTrigramCount, DEFAULT_SETTINGS.maxTrigramCount);
  assert.equal(c.settings.reindexIntervalMs, 3_600_000);
});

test("the schema rejects what Sourcebot rejects", () => {
  assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type: "github", bogus: 1 } } })), /invalid/);
  assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type: "git" } } })), /invalid/);
  assert.throws(() => parseConfig(JSON.stringify({ unknownTopLevel: true })), /invalid/);
});

test("tokens and environment overrides resolve from env", async () => {
  process.env.SBC_TEST_TOKEN = "  secret \n";
  assert.equal(await getTokenFromConfig({ env: "SBC_TEST_TOKEN" }), "secret");
  await assert.rejects(getTokenFromConfig({ env: "SBC_TEST_MISSING" }), /not found/);
  const c = parseConfig(JSON.stringify({ environmentOverrides: { A: { type: "token", value: { env: "SBC_TEST_TOKEN" } }, B: { type: "number", value: 3 } } }));
  assert.deepEqual(await resolveEnvironmentOverrides(c), { A: "secret", B: "3" });
});

test("a {stored} token is rejected in a config file and resolved through the injected resolver", async () => {
  assert.throws(() => parseConfig(JSON.stringify({ connections: { x: { type: "github", token: { stored: "abc" } } } })), /invalid/);
  assert.throws(() => parseConfig(JSON.stringify({ environmentOverrides: { A: { type: "token", value: { stored: "abc" } } } })), /invalid/);
  await assert.rejects(getTokenFromConfig({ stored: "abc" }), /No credential resolver/);
  setCredentialResolver(async (id) => `token-of-${id}`);
  assert.equal(await getTokenFromConfig({ stored: "abc" }), "token-of-abc");
});

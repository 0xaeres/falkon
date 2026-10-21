import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { isRemotePath, loadConfig, parseConfig, getTokenFromConfig, resolveEnvironmentOverrides } from "./config";

test("config loader reads local files and mocked HTTP/HTTPS, preserving source errors", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-config-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, '{ /* comment */ "settings": {"maxFileSize": 99}}');
  try {
    assert.equal((await loadConfig(file)).settings.maxFileSize, 99);
    await assert.rejects(loadConfig(path.join(dir, "missing")), /ENOENT/);
    assert.equal(isRemotePath("HTTP://example.test"), false);
    assert.equal(isRemotePath(file), false);
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response('{"connections":{}}'));
    try {
      for (const url of ["http://example.test/config", "https://example.test/config"]) {
        assert.equal(isRemotePath(url), true);
        assert.deepEqual((await loadConfig(url)).connections, {});
      }
      fetchMock.mock.mockImplementation(async () => new Response("", { status: 503, statusText: "Unavailable" }));
      await assert.rejects(loadConfig("https://example.test/config"), /Failed to fetch config file https:\/\/example.test\/config: Unavailable/);
      fetchMock.mock.mockImplementation(async () => new Response('{"bogus":true}'));
      await assert.rejects(loadConfig("http://example.test/config"), /Config file 'http:\/\/example.test\/config' is invalid/);
      fetchMock.mock.mockImplementation(async () => { throw new Error("offline"); });
      await assert.rejects(loadConfig("http://example.test/config"), /offline/);
    } finally { fetchMock.mock.restore(); }
    fs.writeFileSync(file, "{");
    await assert.rejects(loadConfig(file), SyntaxError);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("knowledge base defaults, configured values and validation remain stable", () => {
  assert.deepEqual(parseConfig("{}").knowledgeBase, { enabled: true, repos: "all", refreshIntervalHours: 24, scanMode: "delta", tokenBudget: 2_000_000, parallelism: 4, citeRepos: [], models: {} });
  const configured = { enabled: true, repos: ["fixtures.test/*"], refreshIntervalHours: 1, scanMode: "full", tokenBudget: 1, parallelism: 16, citeRepos: ["fixtures.test/atlas"], models: { discovery: "d", survey: "s", document: "w", overview: "o" } };
  assert.deepEqual(parseConfig(JSON.stringify({ knowledgeBase: configured })).knowledgeBase, configured);
  for (const override of [{ tokenBudget: 0 }, { parallelism: 17 }, { parallelism: 0 }, { refreshIntervalHours: 0 }, { scanMode: "other" }, { repos: 3 }]) {
    assert.throws(() => parseConfig(JSON.stringify({ knowledgeBase: override })));
  }
  assert.throws(() => parseConfig("{"), SyntaxError);
  assert.throws(() => parseConfig('{"settings":{"maxFileSize":"large"}}', "fixture"), /Config file 'fixture' is invalid/);
});

test("string, boolean and numeric overrides stringify and empty env tokens fail", async () => {
  const cfg = parseConfig(JSON.stringify({ environmentOverrides: { S: { type: "string", value: "ok" }, T: { type: "boolean", value: true }, F: { type: "boolean", value: false }, N: { type: "number", value: 0 } } }));
  assert.deepEqual(await resolveEnvironmentOverrides(cfg), { S: "ok", T: "true", F: "false", N: "0" });
  assert.deepEqual(await resolveEnvironmentOverrides(parseConfig("{}")), {});
  const old = process.env.FALKON_EMPTY_TOKEN;
  try {
    process.env.FALKON_EMPTY_TOKEN = "";
    await assert.rejects(getTokenFromConfig({ env: "FALKON_EMPTY_TOKEN" }), /Environment variable FALKON_EMPTY_TOKEN not found/);
    // Invalid runtime input can arrive from untyped config consumers.
    await assert.rejects(getTokenFromConfig({} as never), /Invalid token configuration/);
  } finally { if (old === undefined) delete process.env.FALKON_EMPTY_TOKEN; else process.env.FALKON_EMPTY_TOKEN = old; }
});

test("Google secret tokens trim payloads and report missing payloads or provider failures", async () => {
  const access = mock.method(SecretManagerServiceClient.prototype, "accessSecretVersion", async () => [{ payload: { data: Buffer.from(" secret \n") } }]);
  try {
    assert.equal(await getTokenFromConfig({ googleCloudSecret: "projects/test/secrets/token/versions/1" }), "secret");
    assert.deepEqual(access.mock.calls[0]!.arguments[0], { name: "projects/test/secrets/token/versions/1" });
    access.mock.mockImplementation(async (): Promise<[{}, undefined, {}]> => [{}, undefined, {}]);
    await assert.rejects(getTokenFromConfig({ googleCloudSecret: "missing" }), /Failed to access Google Cloud secret missing: Secret missing not found/);
    access.mock.mockImplementation(async () => { throw new Error("denied"); });
    await assert.rejects(getTokenFromConfig({ googleCloudSecret: "denied" }), /Failed to access Google Cloud secret denied: denied/);
    access.mock.mockImplementation(async () => { throw "offline"; });
    await assert.rejects(getTokenFromConfig({ googleCloudSecret: "offline" }), /Failed to access Google Cloud secret offline: offline/);
  } finally { access.mock.restore(); }
});

test("each supported connection kind and revision settings survive loading", () => {
  const revisions = { branches: ["main", "feature"], tags: ["v1"] };
  const connections = {
    github: { type: "github", repos: ["acme/app"], exclude: { forks: true, archived: true } },
    local: { type: "git", url: "file:///fixtures/repos/atlas", revisions },
  };
  const contexts = { selected: { include: ["fixtures.test/*"], exclude: ["fixtures.test/archive"], includeConnections: ["local"], excludeConnections: ["github"], includeTopics: ["core"], excludeTopics: ["old"], description: "Fixture context" } };
  const models = [{ provider: "openai", model: "fixture" }];
  const parsed = parseConfig(JSON.stringify({ connections, contexts, models }));
  assert.deepEqual(parsed.connections, connections);
  assert.deepEqual(parsed.contexts, contexts);
  assert.deepEqual(parsed.models, models);
  for (const connection of [{ type: "gerrit", url: "https://review.example.test" }, { type: "gitlab", all: true }, { type: "git", url: "file:///fixtures", unexpected: true }, { type: "git", url: "file:///fixtures", enforcePermissions: true }, { type: "github", enforcePermissionsForPublicRepos: true }]) assert.throws(() => parseConfig(JSON.stringify({ connections: { invalid: connection } })), /invalid/);
});

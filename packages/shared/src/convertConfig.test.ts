import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { convertConfig } from "../../../scripts/convert-config";
import { parseConfig } from "./config";

const OLD = `{
  // comment
  "$schema": "https://example.org/old.json",
  "connections": {
    "gh": { "type": "github", "token": { "env": "T" }, "repos": ["a/b"], },
    "gl": { "type": "gitlab", "token": { "env": "T" } },
    "gt": { "type": "gitea" }, "bb": { "type": "bitbucket" },
    "az": { "type": "azuredevops" }, "ge": { "type": "gerrit", "url": "https://g.io" },
    "other": { "type": "svn" },
    "g": { "type": "git", "url": "https://x.io/r.git" }
  },
  "apps": [{ "type": "github" }],
  "models": [{ "provider": "openai", "model": "a" }, { "provider": "mistral", "model": "b" }, { "provider": "anthropic", "model": "c" }],
  "contexts": { "c": { "include": ["a/*"] } }
}`;

test("drops unsupported connections and keys with a warning each; output validates", () => {
  const { output, warnings } = convertConfig(OLD);
  const out = JSON.parse(output);
  assert.deepEqual(Object.keys(out.connections), ["gh", "g"]);
  assert.equal("apps" in out, false);
  assert.equal(out.$schema, "urn:falkon:config");
  for (const [name, type] of [["gl", "gitlab"], ["gt", "gitea"], ["bb", "bitbucket"], ["az", "azuredevops"], ["ge", "gerrit"], ["other", "svn"]]) {
    assert.ok(warnings.some((w) => w.includes(`'${name}'`) && w.includes(`'${type}'`)), name);
  }
  assert.ok(warnings.some((w) => w.includes("apps")));
  assert.deepEqual(out.models.map((m: { provider: string }) => m.provider), ["openai", "anthropic"]);
  assert.ok(warnings.some((w) => w.includes("models[1]") && w.includes("'mistral'")));
  assert.deepEqual(Object.keys(parseConfig(output).connections), ["gh", "g"]);
});

test("idempotent", () => {
  const once = convertConfig(OLD);
  const twice = convertConfig(once.output);
  assert.equal(twice.output, once.output);
  assert.deepEqual(twice.warnings, []);
});

test("empty object converts to a valid config", () => {
  parseConfig(convertConfig("{}").output);
});

test("invalid JSON throws a clear error", () => {
  assert.throws(() => convertConfig("{ nope"), /invalid JSON/);
  assert.throws(() => convertConfig("[]"), /JSON object/);
  assert.throws(() => convertConfig('{"connections": []}'), /'connections' must be an object/);
  assert.throws(() => convertConfig('{"connections": null}'), /'connections' must be an object/);
  assert.throws(() => convertConfig('{"models": {}}'), /'models' must be an array/);
});

test("a 5 MB file converts quickly", () => {
  const connections = Object.fromEntries(Array.from({ length: 25_000 }, (_, i) => [`c${i}`, { type: i % 2 ? "gitlab" : "github", orgs: ["a".repeat(200)] }]));
  const text = JSON.stringify({ connections });
  assert.ok(text.length > 5_000_000);
  const t = Date.now();
  const { output, warnings } = convertConfig(text);
  assert.equal(warnings.length, 12_500);
  assert.equal(Object.keys(JSON.parse(output).connections).length, 12_500);
  assert.ok(Date.now() - t < 10_000);
});

test("CLI: warnings on stderr, JSON on stdout, non-zero exit on invalid JSON", () => {
  const script = new URL("../../../scripts/convert-config.ts", import.meta.url).pathname;
  const dir = fs.mkdtempSync("/tmp/convcfg-");
  fs.writeFileSync(`${dir}/old.json`, OLD);
  fs.writeFileSync(`${dir}/bad.json`, "{ nope");
  const ok = spawnSync("node", ["--import", "tsx", script, `${dir}/old.json`], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /'gl'.*gitlab/);
  assert.equal(JSON.parse(ok.stdout).connections.gh.type, "github");
  const bad = spawnSync("node", ["--import", "tsx", script, `${dir}/bad.json`], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  fs.writeFileSync(`${dir}/arr.json`, '{"connections": []}');
  const arr = spawnSync("node", ["--import", "tsx", script, `${dir}/arr.json`], { encoding: "utf8" });
  assert.notEqual(arr.status, 0);
  assert.match(arr.stderr, /'connections' must be an object/);
  assert.match(bad.stderr, /invalid JSON/);
});

test("drops the permission-sync and public-access settings and the connections' enforcePermissions keys, one warning each; output validates", () => {
  const old = JSON.stringify({
    settings: { maxFileSize: 1000, enablePublicAccess: true, experiment_repoDrivenPermissionSyncIntervalMs: 1, experiment_userDrivenPermissionSyncIntervalMs: 2 },
    connections: { gh: { type: "github", repos: ["a/b"], enforcePermissions: true, enforcePermissionsForPublicRepos: false }, g: { type: "git", url: "https://x.io/r.git", enforcePermissions: true } },
  });
  const { output, warnings } = convertConfig(old);
  const out = JSON.parse(output);
  assert.deepEqual(out.settings, { maxFileSize: 1000 });
  assert.deepEqual(out.connections, { gh: { type: "github", repos: ["a/b"] }, g: { type: "git", url: "https://x.io/r.git" } });
  for (const key of ["settings.enablePublicAccess", "settings.experiment_repoDrivenPermissionSyncIntervalMs", "settings.experiment_userDrivenPermissionSyncIntervalMs", "connections.gh.enforcePermissions", "connections.gh.enforcePermissionsForPublicRepos", "connections.g.enforcePermissions"]) {
    assert.equal(warnings.filter((w) => w.includes(`'${key}'`)).length, 1, key);
  }
  assert.equal(warnings.length, 6);
  parseConfig(output);
  assert.deepEqual(convertConfig(output).warnings, [], "idempotent");
});

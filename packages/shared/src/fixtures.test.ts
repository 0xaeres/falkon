import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseConfig } from "./config";

test("fixture builds have stable commits, indexed revisions, metadata and an oversized file", () => {
  const root = fileURLToPath(new URL("../../../tests/fixtures/", import.meta.url));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-fixtures-"));
  try {
    const build = (dest: string) => execFileSync("sh", [path.join(root, "build.sh"), dest], { encoding: "utf8" });
    const first = path.join(temp, "first");
    assert.equal(build(first), build(path.join(temp, "second")));
    const config = parseConfig(fs.readFileSync(path.join(first, "config.json"), "utf8"));
    assert.equal(Object.keys(config.connections).length, 4);
    assert.ok(fs.statSync(path.join(first, "repos/atlas/oversized.txt")).size > config.settings.maxFileSize);
    const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", path.join(first, "repos", repo), ...args], { encoding: "utf8" }).trim();
    for (const name of Object.keys(config.connections)) {
      assert.equal(git(name, "branch", "--show-current"), "main");
      assert.equal(git(name, "tag"), "v1");
      assert.match(git(name, "show", "feature:feature.txt"), /feature_only_marker/);
      assert.equal(git(name, "remote", "get-url", "origin"), `https://fixtures.test/${name}.git`);
    }
    assert.equal(git("ledger", "config", "zoekt.public"), "0");
    assert.equal(git("atlas", "config", "zoekt.public"), "1");
    assert.equal(git("worker", "config", "zoekt.fork"), "1");
    assert.equal(git("archive", "config", "zoekt.archived"), "1");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

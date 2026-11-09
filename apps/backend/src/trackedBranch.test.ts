import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloneOrFetch, localDefaultBranch } from "./git";
import { githubRecord } from "./connectors/github";

const sh = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" }).trim();

/** A host with branches main (default) and release, cloned into root/clone.git. */
function fixture(branches = ["release"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-tracked-"));
  const host = path.join(root, "host");
  fs.mkdirSync(host);
  sh(host, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(host, "f"), "1");
  sh(host, "add", ".");
  sh(host, "commit", "-qm", "c1");
  for (const b of branches) sh(host, "branch", b);
  return { host, clone: path.join(root, "clone.git"), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("tracked branch: HEAD follows it on clone and on a second fetch", async () => {
  const f = fixture();
  try {
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "release");
    assert.equal(await localDefaultBranch(f.clone), "release");
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "release");
    assert.equal(await localDefaultBranch(f.clone), "release");
  } finally { f.done(); }
});

test("tracked branch: changing it, then dropping it, re-points HEAD (no entry = remote default)", async () => {
  const f = fixture();
  try {
    await cloneOrFetch(f.clone, f.host);
    assert.equal(await localDefaultBranch(f.clone), "main");
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "release");
    assert.equal(await localDefaultBranch(f.clone), "release");
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "main");
    assert.equal(await localDefaultBranch(f.clone), "main");
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "release");
    await cloneOrFetch(f.clone, f.host);
    assert.equal(await localDefaultBranch(f.clone), "main");
  } finally { f.done(); }
});

test("tracked branch: a branch with a slash works", async () => {
  const f = fixture(["feature/x"]);
  try {
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "feature/x");
    assert.equal(await localDefaultBranch(f.clone), "feature/x");
  } finally { f.done(); }
});

test("tracked branch: missing branch throws naming it and leaves HEAD (fetch and fresh clone)", async () => {
  const f = fixture();
  try {
    await assert.rejects(cloneOrFetch(f.clone, f.host, undefined, undefined, "nope"), /nope/);
    assert.equal(await localDefaultBranch(f.clone), "main"); // fresh clone: HEAD stays at the default
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "release");
    await assert.rejects(cloneOrFetch(f.clone, f.host, undefined, undefined, "nope"), /nope/);
    assert.equal(await localDefaultBranch(f.clone), "release");
  } finally { f.done(); }
});

test("tracked branch: deleted upstream (pruned) fails naming it, HEAD unchanged", async () => {
  const f = fixture();
  try {
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "release");
    sh(f.host, "branch", "-D", "release");
    await assert.rejects(cloneOrFetch(f.clone, f.host, undefined, undefined, "release"), /release/);
    assert.equal(await localDefaultBranch(f.clone), "release");
  } finally { f.done(); }
});

test("tracked branch: empty repository has no branch to track", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-tracked-empty-"));
  try {
    const host = path.join(root, "host");
    fs.mkdirSync(host);
    sh(host, "init", "-q", "-b", "main");
    await assert.rejects(cloneOrFetch(path.join(root, "clone.git"), host, undefined, undefined, "main"), /main/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("tracked branch: equal to the default changes nothing", async () => {
  const f = fixture();
  try {
    await cloneOrFetch(f.clone, f.host, undefined, undefined, "main");
    assert.equal(await localDefaultBranch(f.clone), "main");
  } finally { f.done(); }
});

test("tracked branch: names git would read as options or refs are refused before any git call on the repo", async () => {
  const f = fixture();
  try {
    for (const bad of ["-x", "--upload-pack=touch /tmp/pwn", "-", "a..b", "a b", "@{-1}", "", "refs/heads/main^"]) {
      await assert.rejects(cloneOrFetch(f.clone, f.host, undefined, undefined, bad), /invalid tracked branch/, bad);
    }
    assert.equal(fs.existsSync(f.clone), false);
  } finally { f.done(); }
});

const ghRepo = (full_name: string) =>
  ({ id: 1, full_name, clone_url: "https://github.com/" + full_name + ".git", html_url: "https://github.com/" + full_name, default_branch: "main", owner: { avatar_url: "" }, fork: false, private: false }) as never;

test("githubRecord: repoBranches becomes metadata.trackedBranch; no entry or other repo's entry = none", () => {
  const config = { repoBranches: { "acme/api": "release", "acme/gone": "x" } };
  assert.equal(githubRecord(ghRepo("acme/api"), "https://github.com", config).metadata.trackedBranch, "release");
  assert.equal(githubRecord(ghRepo("acme/web"), "https://github.com", config).metadata.trackedBranch, undefined);
  assert.equal(githubRecord(ghRepo("acme/api"), "https://github.com", {}).metadata.trackedBranch, undefined);
});

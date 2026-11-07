import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "@falkon/shared";
import { isProductSlug, resolveContext, type ResolvableRepo } from "./productResolve";
import { fakeProductTable } from "./productTable.fake";
import { noticeIgnoredContexts, resolveProducts } from "./sync";

const repos: ResolvableRepo[] = [
  { id: 1, name: "github.com/acme/app", metadata: { codeHostMetadata: { github: { topics: ["Web"] } } } },
  { id: 2, name: "github.com/acme/lib", metadata: {} },
  { id: 3, name: "github.com/other/tool", metadata: { codeHostMetadata: { gitlab: { topics: ["cli"] } } } },
];
const connections: Record<string, number[]> = { acme: [1, 2], other: [3] };
const reposOf = (names: string[]) => names.flatMap((n) => connections[n] ?? []);
const resolve = (d: Parameters<typeof resolveContext>[0]) => resolveContext(d, repos, reposOf);

test("resolution: include globs, connections and topics, then excludes, deduplicated", () => {
  assert.deepEqual(resolve({ include: ["github.com/acme/*"] }), ["github.com/acme/app", "github.com/acme/lib"]);
  assert.deepEqual(resolve({ includeConnections: ["other", "acme"] }), ["github.com/other/tool", "github.com/acme/app", "github.com/acme/lib"]);
  assert.deepEqual(resolve({ includeTopics: ["WEB", "cl*"] }), ["github.com/acme/app", "github.com/other/tool"]);
  assert.deepEqual(resolve({ include: ["**"], exclude: ["**/lib"], excludeConnections: ["other"] }), ["github.com/acme/app"]);
  assert.deepEqual(resolve({ include: ["**"], excludeTopics: ["web"] }), ["github.com/acme/lib", "github.com/other/tool"]);
  assert.deepEqual(resolve({ include: ["github.com/acme/app"], includeConnections: ["acme", "missing", "__proto__"] }), ["github.com/acme/app", "github.com/acme/lib"]);
  assert.deepEqual(resolve({}), []);
});

test("slugs: ^[a-z0-9][a-z0-9-]{0,62}$", () => {
  for (const ok of ["a", "0", "core", "a-b", "a".repeat(63)]) assert.ok(isProductSlug(ok), ok);
  for (const bad of ["", "-a", "A", "a_b", "a.b", "a/b", "a b", "a\n", "a".repeat(64), "..", "é", "__proto__"]) assert.ok(!isProductSlug(bad), JSON.stringify(bad));
});

test("every Product is re-resolved from its own definition on each sync, connections included", async () => {
  const table = fakeProductTable([
    { slug: "mine", name: "Mine", definition: { include: ["github.com/acme/*"] }, repoNames: ["github.com/acme/app"] },
    // its repositories come from a connection defined in config.json: still resolved
    { slug: "tools", name: "Tools", definition: { includeConnections: ["other"] }, repoNames: [] },
  ]);
  await resolveProducts(resolve, table);
  assert.deepEqual((await table.findMany()).map((p) => [p.slug, p.name, p.repoNames]), [
    ["mine", "Mine", ["github.com/acme/app", "github.com/acme/lib"]],
    ["tools", "Tools", ["github.com/other/tool"]],
  ]);
});

test("a re-resolve loses to a concurrent UI write: the row changed since it was read is skipped, then picked up next round", async () => {
  const table = fakeProductTable([{ slug: "mine", name: "Mine", definition: { include: ["github.com/acme/app"] }, repoNames: [] }]);
  const racing = Object.create(table, {
    findMany: {
      value: async (args: unknown) => {
        const read = await table.findMany(args as never);
        // the UI PATCH lands between the sync's read and its write
        await table.updateMany({ where: { slug: "mine" }, data: { definition: { include: ["github.com/other/*"] }, repoNames: ["github.com/other/tool"] } });
        return read;
      },
    },
  });
  await resolveProducts(resolve, racing);
  assert.deepEqual(table.rows[0]!.repoNames, ["github.com/other/tool"], "the UI write survives");
  await resolveProducts(resolve, table);
  assert.deepEqual(table.rows[0]!.repoNames, ["github.com/other/tool"], "next round resolves the new definition");
});

test("a config file that still has `contexts` logs one line at load; one without logs nothing", () => {
  const lines: string[] = [];
  noticeIgnoredContexts(parseConfig(JSON.stringify({ contexts: { core: { include: ["**"] } } })), (l) => lines.push(l));
  assert.deepEqual(lines, ["config: `contexts` is ignored; Products are now created in /setup"]);
  noticeIgnoredContexts(parseConfig("{}"), (l) => lines.push(l));
  noticeIgnoredContexts(parseConfig(JSON.stringify({ contexts: {} })), (l) => lines.push(l));
  assert.equal(lines.length, 1);
});

// ---- tags in the clones (S77): real temporary repositories, no network ----------------

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloneOrFetch, sortedRefs } from "./git";

const sh = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...a], { encoding: "utf8" }).trim();

function tagFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falkon-tags-"));
  const host = path.join(root, "host");
  const clone = path.join(root, "clone.git");
  fs.mkdirSync(host);
  sh(host, "init", "-q", "-b", "main");
  let n = 0;
  const commit = () => { fs.writeFileSync(path.join(host, `f${n++}`), String(n)); sh(host, "add", "."); sh(host, "commit", "-qm", `c${n}`); return sh(host, "rev-parse", "HEAD"); };
  const tags = () => sh(clone, "for-each-ref", "--format=%(refname:strip=2) %(objectname)", "refs/tags").split("\n").filter(Boolean);
  return { host, clone, commit, tags, sh, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("tags: new tag on a branch commit arrives (already worked)", async () => {
  const f = tagFixture();
  try {
    const c1 = f.commit();
    await cloneOrFetch(f.clone, f.host);
    const c2 = f.commit();
    f.sh(f.host, "tag", "v1");
    await cloneOrFetch(f.clone, f.host);
    assert.deepEqual(f.tags(), [`v1 ${c2}`]);
    assert.notEqual(c1, c2);
  } finally { f.done(); }
});

test("tags: first clone copies tags (clone --bare, unchanged)", async () => {
  const f = tagFixture();
  try {
    const c1 = f.commit();
    f.sh(f.host, "tag", "v1");
    await cloneOrFetch(f.clone, f.host);
    assert.deepEqual(f.tags(), [`v1 ${c1}`]);
  } finally { f.done(); }
});

test("tags: a tag on a commit no branch reaches arrives", async () => {
  const f = tagFixture();
  try {
    f.commit();
    await cloneOrFetch(f.clone, f.host);
    f.sh(f.host, "checkout", "-q", "--detach");
    const orphan = f.commit();
    f.sh(f.host, "tag", "lonely");
    f.sh(f.host, "checkout", "-q", "main");
    await cloneOrFetch(f.clone, f.host);
    assert.deepEqual(f.tags(), [`lonely ${orphan}`]);
  } finally { f.done(); }
});

test("tags: a tag deleted on the host disappears, and sortedRefs follows", async () => {
  const f = tagFixture();
  try {
    f.commit();
    f.sh(f.host, "tag", "v1");
    f.sh(f.host, "tag", "v2");
    await cloneOrFetch(f.clone, f.host);
    assert.deepEqual((await sortedRefs(f.clone, "refs/tags")).sort(), ["v1", "v2"]);
    f.sh(f.host, "tag", "-d", "v1");
    await cloneOrFetch(f.clone, f.host);
    assert.deepEqual(await sortedRefs(f.clone, "refs/tags"), ["v2"]);
  } finally { f.done(); }
});

test("tags: a tag moved on the host moves in the clone (annotated too), and sortedRefs follows", async () => {
  const f = tagFixture();
  try {
    f.commit();
    f.sh(f.host, "tag", "light");
    f.sh(f.host, "tag", "-a", "note", "-m", "m");
    await cloneOrFetch(f.clone, f.host);
    const c2 = f.commit();
    f.sh(f.host, "tag", "-f", "light");
    f.sh(f.host, "tag", "-f", "-a", "note", "-m", "m2");
    await cloneOrFetch(f.clone, f.host);
    assert.equal(sh(f.clone, "rev-parse", "light^{commit}"), c2);
    assert.equal(sh(f.clone, "rev-parse", "note^{commit}"), c2);
    assert.deepEqual((await sortedRefs(f.clone, "refs/tags")).sort(), ["light", "note"]);
  } finally { f.done(); }
});

test("tags: host with no tags keeps branches; same-named tag and branch both survive; force-push plus tag delete in one fetch", async () => {
  const f = tagFixture();
  try {
    f.commit();
    await cloneOrFetch(f.clone, f.host);
    await cloneOrFetch(f.clone, f.host); // no tags anywhere: nothing pruned that should stay
    assert.deepEqual(f.tags(), []);
    assert.equal(sh(f.clone, "rev-parse", "refs/heads/main"), sh(f.host, "rev-parse", "main"));
    f.sh(f.host, "branch", "same");
    f.sh(f.host, "tag", "same");
    f.sh(f.host, "tag", "gone");
    await cloneOrFetch(f.clone, f.host);
    assert.ok(sh(f.clone, "rev-parse", "--verify", "refs/heads/same") && sh(f.clone, "rev-parse", "--verify", "refs/tags/same"));
    f.sh(f.host, "tag", "-d", "gone");
    f.sh(f.host, "reset", "-q", "--hard", "HEAD~0");
    f.sh(f.host, "commit", "-q", "--amend", "-m", "rewritten");
    await cloneOrFetch(f.clone, f.host);
    assert.equal(sh(f.clone, "rev-parse", "refs/heads/main"), sh(f.host, "rev-parse", "main"));
    assert.deepEqual(f.tags().map((l) => l.split(" ")[0]), ["same"]);
  } finally { f.done(); }
});

test("tags: a failed fetch leaves the old tags in place", async () => {
  const f = tagFixture();
  try {
    f.commit();
    f.sh(f.host, "tag", "v1");
    await cloneOrFetch(f.clone, f.host);
    await assert.rejects(cloneOrFetch(f.clone, path.join(f.host, "missing")));
    assert.equal(f.tags().length, 1);
  } finally { f.done(); }
});

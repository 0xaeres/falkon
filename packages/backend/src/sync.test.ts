import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "@falkon/shared";
import { isProductSlug, resolveContext, type ResolvableRepo } from "./productResolve";
import { fakeProductTable } from "./productTable.fake";
import { syncProducts } from "./sync";

const repos: ResolvableRepo[] = [
  { id: 1, name: "github.com/acme/app", metadata: { codeHostMetadata: { github: { topics: ["Web"] } } } },
  { id: 2, name: "github.com/acme/lib", metadata: {} },
  { id: 3, name: "github.com/other/tool", metadata: { codeHostMetadata: { gitlab: { topics: ["cli"] } } } },
];
const connections: Record<string, number[]> = { acme: [1, 2], other: [3] };
const reposOf = (names: string[]) => names.flatMap((n) => connections[n] ?? []);
const resolve = (d: Parameters<typeof resolveContext>[0]) => resolveContext(d, repos, reposOf);
const cfg = (contexts: Config["contexts"]) => ({ contexts }) as unknown as Config;

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

test("config import upserts source=config Products, deletes dropped ones and is idempotent", async () => {
  const table = fakeProductTable();
  await syncProducts(cfg({ core: { include: ["github.com/acme/*"], description: "Core" }, tools: { includeConnections: ["other"] } }), resolve, table);
  const first = await table.findMany();
  assert.deepEqual(first.map((p) => [p.slug, p.source, p.name, p.description, p.repoNames, p.definition]), [
    ["core", "config", "core", "Core", ["github.com/acme/app", "github.com/acme/lib"], { include: ["github.com/acme/*"] }],
    ["tools", "config", "tools", null, ["github.com/other/tool"], { includeConnections: ["other"] }],
  ]);
  await syncProducts(cfg({ core: { include: ["github.com/acme/*"], description: "Core" }, tools: { includeConnections: ["other"] } }), resolve, table);
  const again = await table.findMany();
  assert.deepEqual(again.map((p) => [p.id, p.slug, p.repoNames]), first.map((p) => [p.id, p.slug, p.repoNames]), "ids and membership stable");
  await syncProducts(cfg({ core: { include: ["github.com/acme/app"] } }), resolve, table);
  assert.deepEqual((await table.findMany()).map((p) => [p.slug, p.repoNames, p.description]), [["core", ["github.com/acme/app"], null]]);
});

test("config import never touches source=api Products; a colliding context is skipped and api wins", async () => {
  const log = mock.method(console, "log", () => {});
  try {
    const table = fakeProductTable([{ slug: "core", source: "api", name: "API core", definition: { include: ["github.com/other/*"] }, repoNames: ["github.com/other/tool"] }]);
    await syncProducts(cfg({ core: { include: ["github.com/acme/*"] } }), resolve, table);
    const [row] = await table.findMany();
    assert.deepEqual([row!.slug, row!.source, row!.name, row!.repoNames], ["core", "api", "API core", ["github.com/other/tool"]]);
    assert.ok(log.mock.calls.some((c) => /context "core" skipped, an api Product has that slug/.test(String(c.arguments[0]))));
    await syncProducts(cfg({}), resolve, table);
    assert.equal((await table.findMany()).length, 1, "removing every context deletes config Products only");
  } finally { log.mock.restore(); }
});

test("api Products are re-resolved from their own definition on each sync", async () => {
  const table = fakeProductTable([{ slug: "mine", source: "api", name: "Mine", definition: { include: ["github.com/acme/*"] }, repoNames: ["github.com/acme/app"] }]);
  await syncProducts(cfg({}), resolve, table);
  const [row] = await table.findMany();
  assert.deepEqual([row!.source, row!.name, row!.repoNames], ["api", "Mine", ["github.com/acme/app", "github.com/acme/lib"]]);
});

test("a re-resolve loses to a concurrent admin write: the row changed since it was read is skipped, then picked up next round", async () => {
  const table = fakeProductTable([{ slug: "mine", source: "api", name: "Mine", definition: { include: ["github.com/acme/app"] }, repoNames: [] }]);
  const racing = Object.create(table, {
    findMany: {
      value: async (args: unknown) => {
        const read = await table.findMany(args as never);
        // the admin PUT lands between the sync's read and its write
        await table.updateMany({ where: { slug: "mine", source: "api" }, data: { definition: { include: ["github.com/other/*"] }, repoNames: ["github.com/other/tool"] } });
        return read;
      },
    },
  });
  await syncProducts(cfg({}), resolve, racing);
  assert.deepEqual(table.rows[0]!.repoNames, ["github.com/other/tool"], "the admin write survives");
  await syncProducts(cfg({}), resolve, table);
  assert.deepEqual(table.rows[0]!.repoNames, ["github.com/other/tool"], "next round resolves the new definition");
});

test("contexts whose name is not a valid slug are skipped with a log line", async () => {
  const log = mock.method(console, "log", () => {});
  try {
    const table = fakeProductTable();
    // JSON.parse keeps "__proto__" as an own key, as a config file would.
    await syncProducts(cfg(JSON.parse('{"My Context":{"include":["**"]},"__proto__":{"include":["**"]},"ok":{"include":["**"]}}')), resolve, table);
    assert.deepEqual((await table.findMany()).map((p) => p.slug), ["ok"]);
    assert.ok(log.mock.calls.some((c) => /context "My Context" skipped, not a valid Product slug/.test(String(c.arguments[0]))));
  } finally { log.mock.restore(); }
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

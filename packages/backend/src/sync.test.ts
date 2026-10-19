import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "@sbc/shared";
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

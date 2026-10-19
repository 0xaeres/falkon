import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "@sbc/shared";
import { claimIndexRequests, claimSyncRequests, syncConnectionRows } from "./sync";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
const matches = (row: Row, where: Where = {}) =>
  Object.entries(where).every(([k, v]) => {
    const value = row[k];
    if (v && typeof v === "object" && "notIn" in v) return !(v as { notIn: unknown[] }).notIn.includes(value);
    if (v && typeof v === "object" && "not" in v) return value !== (v as { not: unknown }).not;
    if (v instanceof Date) return value instanceof Date && value.getTime() === v.getTime();
    return value === v;
  });

/** In-memory stand-in for a Prisma delegate (tests have no database). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeTable(seed: Row[]): any {
  const rows: Row[] = seed.map((r, i) => ({ id: i + 1, ...r }));
  return {
    rows,
    async findMany(args: { where?: Where } = {}) {
      return rows.filter((r) => matches(r, args.where)).map((r) => ({ ...r }));
    },
    async upsert(args: { where: Where; create: Row; update: Row }) {
      const r = rows.find((row) => matches(row, args.where));
      if (r) Object.assign(r, args.update);
      else rows.push({ id: rows.length + 1, source: "config", ...args.create });
    },
    async updateMany(args: { where: Where; data: Row }) {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const r of hit) Object.assign(r, args.data);
      return { count: hit.length };
    },
    async deleteMany(args: { where: Where }) {
      const gone = rows.filter((r) => matches(r, args.where));
      for (const r of gone) rows.splice(rows.indexOf(r), 1);
      return { count: gone.length };
    },
  };
}

const gh = (repo: string) => ({ type: "github", repos: [repo] });
const cfg = (connections: Record<string, unknown>) => ({ connections }) as unknown as Config;
const names = (t: { rows: Row[] }) => t.rows.map((r) => `${r.name}:${r.source}`).sort();

test("a config sync mirrors config connections and leaves api connections alone", async () => {
  const table = fakeTable([
    { name: "gone", source: "config", config: {} },
    { name: "ui-abc", source: "api", config: gh("o/api") },
  ]);
  await syncConnectionRows(cfg({ main: gh("o/a") }), table);
  assert.deepEqual(names(table), ["main:config", "ui-abc:api"]);
  await syncConnectionRows(cfg({ main: gh("o/b") }), table);
  assert.deepEqual(table.rows.find((r: Row) => r.name === "main")!.config, gh("o/b"), "config rows still update");
  await syncConnectionRows(cfg({}), table);
  assert.deepEqual(names(table), ["ui-abc:api"], "removing every config connection deletes config rows only");
});

test("a config connection named like an api connection is skipped and the api row wins", async () => {
  const log = mock.method(console, "log", () => {});
  try {
    const table = fakeTable([{ name: "ui-abc", source: "api", config: gh("o/api") }]);
    await syncConnectionRows(cfg({ "ui-abc": gh("o/config") }), table);
    assert.deepEqual(table.rows.map((r: Row) => [r.name, r.source, r.config]), [["ui-abc", "api", gh("o/api")]]);
    assert.ok(log.mock.calls.some((c) => /connection "ui-abc" skipped, an api connection has that name/.test(String(c.arguments[0]))));
  } finally {
    log.mock.restore();
  }
});

test("a sync request is claimed exactly once, and a newer request written meanwhile stays for the next tick", async () => {
  const t1 = new Date("2026-10-20T10:00:00Z");
  const table = fakeTable([{ name: "ui-a", source: "api", syncRequestedAt: t1 }, { name: "idle", source: "api", syncRequestedAt: null }]);
  const [a, b] = await Promise.all([claimSyncRequests(table), claimSyncRequests(table)]);
  assert.deepEqual([...a, ...b], ["ui-a"], "two concurrent ticks: one winner");
  assert.deepEqual(await claimSyncRequests(table), []);

  const t2 = new Date("2026-10-20T10:01:00Z");
  table.rows[0]!.syncRequestedAt = t1;
  const racing = Object.assign(Object.create(table), {
    findMany: async (args: never) => {
      const read = await table.findMany(args);
      table.rows[0]!.syncRequestedAt = t2; // a newer request lands between the read and the claim
      return read;
    },
  });
  assert.deepEqual(await claimSyncRequests(racing), []);
  assert.equal(table.rows[0]!.syncRequestedAt, t2);
  assert.deepEqual(await claimSyncRequests(table), ["ui-a"]);
});

test("an index request is claimed exactly once and yields the repo id", async () => {
  const table = fakeTable([{ name: "github.com/o/a", indexRequestedAt: new Date() }, { name: "github.com/o/b", indexRequestedAt: null }]);
  const [a, b] = await Promise.all([claimIndexRequests(table), claimIndexRequests(table)]);
  assert.deepEqual([...a, ...b], [1]);
  assert.deepEqual(await claimIndexRequests(table), []);
});

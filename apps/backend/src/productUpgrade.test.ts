// The upgrade that removes config-sourced Products (2026-11-07): packages/db/prisma/pre-push.sql, run by the db `push`
// script before `prisma db push`. The Postgres cases use a scratch schema in PROVENANCE_TEST_DATABASE_URL and skip without it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PrismaClient } from "@falkon/db";
import { pgSkip, pgUrl } from "./provenancePg.testing";

const dbDir = new URL("../../../packages/db/", import.meta.url);
const upgradeSql = fs.readFileSync(new URL("prisma/pre-push.sql", dbDir), "utf8");

test("the db push script runs the upgrade first and never accepts data loss", () => {
  const push: string = JSON.parse(fs.readFileSync(new URL("package.json", dbDir), "utf8")).scripts.push;
  assert.match(push, /^prisma db execute --schema prisma\/schema\.prisma --file prisma\/pre-push\.sql && prisma db push\b/);
  assert.doesNotMatch(push, /accept-data-loss/);
});

const SCHEMA = "product_upgrade_test";
let db: PrismaClient | undefined;
after(() => db?.$disconnect());

/** A client on a fresh scratch schema holding the pre-upgrade tables: Product with `source`, Chat, SearchContext. */
async function legacyDb() {
  const u = new URL(pgUrl!);
  // the scratch schema is dropped on every run: only a local disposable database
  if (!u.pathname.endsWith("_test") || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) throw new Error("PROVENANCE_TEST_DATABASE_URL must name a local database ending in _test");
  u.searchParams.set("schema", SCHEMA);
  db ??= new PrismaClient({ datasourceUrl: u.toString() });
  for (const sql of [
    `DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`,
    `CREATE SCHEMA "${SCHEMA}"`,
    `CREATE TYPE "${SCHEMA}"."ProductSource" AS ENUM ('config', 'api')`,
    `CREATE TABLE "${SCHEMA}"."Product" ("id" SERIAL PRIMARY KEY, "slug" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "source" "${SCHEMA}"."ProductSource" NOT NULL)`,
    `CREATE TABLE "${SCHEMA}"."Chat" ("id" TEXT PRIMARY KEY, "productId" TEXT)`,
    `CREATE TABLE "${SCHEMA}"."SearchContext" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL UNIQUE, "repoNames" TEXT[])`,
    `INSERT INTO "${SCHEMA}"."Product" ("slug", "name", "source") VALUES ('core', 'core', 'config'), ('mine', 'Mine', 'api'), ('loose', 'Loose', 'api')`,
    `INSERT INTO "${SCHEMA}"."Chat" ("id", "productId") VALUES ('c-core', 'core'), ('c-mine', 'mine'), ('c-web', NULL)`,
    `INSERT INTO "${SCHEMA}"."SearchContext" ("name", "repoNames") VALUES ('core', ARRAY['github.com/acme/app'])`,
  ]) await db.$executeRawUnsafe(sql);
  return db;
}

const state = async (c: PrismaClient) => ({
  products: (await c.$queryRawUnsafe<{ slug: string }[]>(`SELECT "slug" FROM "${SCHEMA}"."Product" ORDER BY "slug"`)).map((r) => r.slug),
  chats: (await c.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${SCHEMA}"."Chat" ORDER BY "id"`)).map((r) => r.id),
  sourceColumn: (await c.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'Product' AND column_name = 'source'`)).length,
  searchContext: (await c.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_name = 'SearchContext'`)).length,
  productSource: (await c.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${SCHEMA}' AND t.typname = 'ProductSource'`)).length,
});

test("the upgrade deletes config Products and their chats, keeps api Products (with or without a connection) and their chats, and drops source, ProductSource and SearchContext", { skip: pgSkip }, async () => {
  const c = await legacyDb();
  await c.$executeRawUnsafe(upgradeSql);
  const upgraded = { products: ["loose", "mine"], chats: ["c-mine", "c-web"], sourceColumn: 0, searchContext: 0, productSource: 0 };
  assert.deepEqual(await state(c), upgraded);
  // a second run, now without the `source` column, is a no-op and not an error
  await c.$executeRawUnsafe(upgradeSql);
  assert.deepEqual(await state(c), upgraded);
  // a Product created in /setup with the deleted config Product's slug starts with no chats
  await c.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."Product" ("slug", "name") VALUES ('core', 'Core again')`);
  assert.deepEqual(await c.$queryRawUnsafe(`SELECT "id" FROM "${SCHEMA}"."Chat" WHERE "productId" = 'core'`), []);
});

test("the upgrade on an empty database (first start) is a no-op", { skip: pgSkip }, async () => {
  const c = await legacyDb();
  await c.$executeRawUnsafe(`DROP SCHEMA "${SCHEMA}" CASCADE`);
  await c.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
  await c.$executeRawUnsafe(upgradeSql);
  assert.deepEqual(await c.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`), []);
});

// Test helper: the Postgres ProvenanceStore on a disposable database named in PROVENANCE_TEST_DATABASE_URL (its database
// name must end in `_test`; every run empties it). Unset, the Postgres variants of the tests are skipped.
import { PrismaClient } from "@falkon/db";
import { postgresProvenanceStore } from "@falkon/shared";

export const pgUrl = process.env.PROVENANCE_TEST_DATABASE_URL;
export const pgSkip = pgUrl ? false : "PROVENANCE_TEST_DATABASE_URL not set";

let db: PrismaClient | undefined;

export async function pgTestStore(names: string[]) {
  const u = pgUrl ? new URL(pgUrl) : undefined;
  // every run TRUNCATEs Repo CASCADE: only a local disposable database
  if (!u || !u.pathname.endsWith("_test") || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) throw new Error("PROVENANCE_TEST_DATABASE_URL must name a local database ending in _test");
  db ??= new PrismaClient({ datasourceUrl: pgUrl });
  await db.$executeRawUnsafe(`TRUNCATE "Repo" RESTART IDENTITY CASCADE`);
  const ids: Record<string, number> = {};
  for (const name of names) {
    const r = await db.repo.create({ data: { name, cloneUrl: `file:///${name}`, external_id: name, external_codeHostType: "genericGitHost", external_codeHostUrl: "file:///" } });
    ids[name] = r.id;
  }
  return { store: postgresProvenanceStore(db), id: (n: string) => ids[n]! };
}

export const pgClose = () => db?.$disconnect();

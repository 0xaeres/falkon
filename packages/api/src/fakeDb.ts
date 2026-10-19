// Test helper: the Prisma surface PrismaProductRegistry uses, in memory.
import type { PrismaClient } from "@sbc/db";
import { fakeProductTable } from "../../backend/src/productTable.fake";

export function fakeDb(seed: Parameters<typeof fakeProductTable>[0] = [], repos = ["github.com/acme/app", "github.com/acme/lib", "github.com/other/tool"]) {
  const product = fakeProductTable(seed);
  const db = {
    product,
    repo: { findMany: async () => repos.map((name, i) => ({ id: i + 1, name, metadata: {} })) },
    connection: { findMany: async () => [{ name: "other", repos: [{ repoId: 3 }] }] },
  } as unknown as Pick<PrismaClient, "product" | "repo" | "connection">;
  return { db, rows: product.rows, setRepos: (names: string[]) => repos.splice(0, repos.length, ...names) };
}

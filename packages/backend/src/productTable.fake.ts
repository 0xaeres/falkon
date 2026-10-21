// In-memory stand-in for `prisma.product` (tests have no database): the subset of calls the sync and the admin
// registry make, with the unique-slug violation Prisma raises (code P2002).
import type { PrismaClient } from "@falkon/db";

export interface ProductRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  source: "config" | "api";
  definition: unknown;
  repoNames: string[];
  createdAt: Date;
  updatedAt: Date;
}
type Where = Record<string, unknown>;

const matches = (row: ProductRow, where: Where = {}) =>
  Object.entries(where).every(([k, v]) => {
    const value = (row as unknown as Record<string, unknown>)[k];
    if (v && typeof v === "object" && "notIn" in v) return !(v as { notIn: unknown[] }).notIn.includes(value);
    if (v instanceof Date) return value instanceof Date && value.getTime() === v.getTime();
    return value === v;
  });

export function fakeProductTable(seed: Partial<ProductRow>[] = []) {
  let nextId = 1;
  const rows: ProductRow[] = [];
  const clone = (r: ProductRow) => structuredClone(r);
  const table = {
    rows,
    async findMany(args: { where?: Where } = {}) {
      return rows.filter((r) => matches(r, args.where)).sort((a, b) => a.slug.localeCompare(b.slug)).map(clone);
    },
    async findUnique(args: { where: Where }) {
      const r = rows.find((row) => matches(row, args.where));
      return r ? clone(r) : null;
    },
    async create(args: { data: Partial<ProductRow> }) {
      if (rows.some((r) => r.slug === args.data.slug)) throw Object.assign(new Error("Unique constraint failed on the fields: (`slug`)"), { code: "P2002" });
      const now = new Date();
      const row: ProductRow = { id: nextId++, name: "", description: null, source: "api", definition: {}, repoNames: [], createdAt: now, updatedAt: now, slug: "", ...args.data } as ProductRow;
      rows.push(row);
      return clone(row);
    },
    async updateMany(args: { where: Where; data: Partial<ProductRow> }) {
      const hit = rows.filter((r) => matches(r, args.where));
      for (const r of hit) Object.assign(r, structuredClone(args.data), { updatedAt: new Date(Math.max(Date.now(), r.updatedAt.getTime() + 1)) });
      return { count: hit.length };
    },
    async deleteMany(args: { where: Where }) {
      const keep = rows.filter((r) => !matches(r, args.where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
  };
  for (const s of seed) void table.create({ data: s });
  return Object.assign(table as unknown as PrismaClient["product"], { rows });
}

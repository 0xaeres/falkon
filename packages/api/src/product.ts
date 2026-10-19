import type { PrismaClient } from "@sbc/db";
import { isProductSlug, loadContextResolver, type ProductDefinition } from "../../backend/src/productResolve";

export { isProductSlug as isProductName, type ProductDefinition };

/** A Product as the admin API shows it. */
export interface ProductView {
  slug: string;
  name: string;
  description: string | null;
  source: "config" | "api";
  definition: ProductDefinition;
  repoNames: string[];
  createdAt: Date;
  updatedAt: Date;
}
export interface ProductInput {
  name: string;
  description?: string | null;
  definition: ProductDefinition;
}

/** Product registry port. The product path reads `find` once per request (no cache), so membership changes apply at once. */
export interface ProductRegistry {
  /** The Product's stable id and resolved membership, or undefined. Callers check the slug syntax first. */
  find(slug: string): Promise<{ id: number; repoNames: string[] } | undefined>;
  list(): Promise<ProductView[]>;
  get(slug: string): Promise<ProductView | undefined>;
  /** Creates a `source=api` Product; "conflict" when the slug exists (either source). */
  create(slug: string, input: ProductInput): Promise<ProductView | "conflict">;
  /** Replaces an api Product's name, description and definition; config Products are read-only ("conflict"). */
  update(slug: string, input: ProductInput): Promise<ProductView | "not-found" | "conflict">;
  remove(slug: string): Promise<"ok" | "not-found" | "conflict">;
}
export const PRODUCT_REGISTRY = Symbol("ProductRegistry");

type Row = { id: number; slug: string; name: string; description: string | null; source: "config" | "api"; definition: unknown; repoNames: string[]; createdAt: Date; updatedAt: Date };
const view = ({ id: _id, ...r }: Row): ProductView => ({ ...r, definition: r.definition as ProductDefinition });
const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/**
 * Prisma adapter. api Products resolve their definition against the Repo rows at write time (and the backend
 * re-resolves them on every sync). Every write is conditioned on `source: api`, so a config row is never changed here.
 */
export class PrismaProductRegistry implements ProductRegistry {
  constructor(private readonly db: Pick<PrismaClient, "product" | "repo" | "connection">) {}

  async find(slug: string) {
    const r = await this.db.product.findUnique({ where: { slug }, select: { id: true, repoNames: true } });
    return r ?? undefined;
  }
  async list() {
    return (await this.db.product.findMany({ orderBy: { slug: "asc" } })).map(view);
  }
  async get(slug: string) {
    const r = await this.db.product.findUnique({ where: { slug } });
    return r ? view(r) : undefined;
  }
  private async data(input: ProductInput) {
    const resolve = await loadContextResolver(this.db);
    return { name: input.name, description: input.description ?? null, definition: input.definition as object, repoNames: resolve(input.definition) };
  }
  async create(slug: string, input: ProductInput) {
    try {
      return view(await this.db.product.create({ data: { slug, source: "api", ...(await this.data(input)) } }));
    } catch (e) {
      if (isUniqueViolation(e)) return "conflict" as const;
      throw e;
    }
  }
  async update(slug: string, input: ProductInput) {
    const { count } = await this.db.product.updateMany({ where: { slug, source: "api" }, data: await this.data(input) });
    if (count === 0) return (await this.find(slug)) ? ("conflict" as const) : ("not-found" as const);
    return (await this.get(slug)) ?? ("not-found" as const);
  }
  async remove(slug: string) {
    const { count } = await this.db.product.deleteMany({ where: { slug, source: "api" } });
    if (count > 0) return "ok" as const;
    return (await this.find(slug)) ? ("conflict" as const) : ("not-found" as const);
  }
}

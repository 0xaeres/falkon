import type { PrismaClient } from "@falkon/db";
import { isProductSlug } from "../../backend/src/productResolve";

export { isProductSlug as isProductName };

/** Product registry port. The product path reads `find` once per request (no cache), so membership changes apply at once. Products are written only through the /ui routes. */
export interface ProductRegistry {
  /** The Product's stable id and resolved membership, or undefined. Callers check the slug syntax first. */
  find(slug: string): Promise<{ id: number; repoNames: string[] } | undefined>;
}
export const PRODUCT_REGISTRY = Symbol("ProductRegistry");

/** Prisma adapter: read-only. */
export class PrismaProductRegistry implements ProductRegistry {
  constructor(private readonly db: Pick<PrismaClient, "product">) {}

  async find(slug: string) {
    const r = await this.db.product.findUnique({ where: { slug }, select: { id: true, repoNames: true } });
    return r ?? undefined;
  }
}

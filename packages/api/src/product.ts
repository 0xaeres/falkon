/** Product lookup port. The first adapter reads today's SearchContext rows; S4 swaps in the registry. */
export const PRODUCT_RESOLVER = Symbol("ProductResolver");

export interface ProductResolver {
  /** The repo names a Product serves, or undefined when no such Product exists. */
  repoNames(product: string): Promise<string[] | undefined>;
}

/** Checked before any lookup. */
export const isProductName = (name: string) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);

/** Maps a Product name to a SearchContext of the same name (`loadContexts` in the web package). */
export class ContextProductResolver implements ProductResolver {
  constructor(private readonly load: () => Promise<Record<string, string[]>>) {}
  async repoNames(product: string) {
    const contexts = await this.load();
    return Object.hasOwn(contexts, product) ? contexts[product] : undefined;
  }
}

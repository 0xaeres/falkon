// Product-scoped code search for the Falkon UI (D135): GET /ui/products/:slug/search on the admin listener.
import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { searchQuerySchema } from "@falkon/contracts";
import type { PrismaClient } from "@falkon/db";
import { noneAccessPolicy, qRepo, QuerySyntaxError, search, SearchContextNotFoundError } from "@falkon/shared";
import { isProductName } from "./product";
import { error } from "./request";

type Db = Pick<PrismaClient, "product" | "searchContext">;

const CONTEXTS_TTL_MS = 30_000;
const CONTEXTS_LOAD_MS = 2_000;

export class SearchService {
  private cache?: { at: number; contexts: Record<string, string[]> };

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Search contexts by name, cached for 30 s. A failed or slow (2 s) load keeps the last known value (none: no contexts,
   * so `context:` is a 404) and is retried after the next TTL, so a slow database never stalls a search.
   */
  private async contexts(): Promise<Record<string, string[]>> {
    const t = this.now();
    if (this.cache && t - this.cache.at < CONTEXTS_TTL_MS) return this.cache.contexts;
    let contexts = this.cache?.contexts ?? {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rows = await Promise.race([
        this.db.searchContext.findMany({ select: { name: true, repoNames: true } }),
        new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error("contexts load timed out")), CONTEXTS_LOAD_MS))),
      ]);
      contexts = Object.fromEntries(rows.map((c) => [c.name, c.repoNames]));
    } catch {
      // keep contexts
    } finally {
      clearTimeout(timer);
    }
    this.cache = { at: t, contexts };
    return contexts;
  }

  async search(slug: string, params: z.infer<typeof searchQuerySchema>) {
    const row = isProductName(slug) ? await this.db.product.findUnique({ where: { slug }, select: { repoNames: true } }) : null;
    if (!row) throw error(404, "NOT_FOUND", "Product not found.");
    if (!params.q.trim()) throw error(400, "EMPTY_QUERY", "Enter a query.");
    // The Product's repositories exactly (the same intersection the MCP path uses).
    const policy = noneAccessPolicy();
    const { scope } = policy.effectiveScope(policy.authenticate(undefined)!, row.repoNames)!;
    try {
      const r = await search(params.q, {
        regex: params.regex === "1",
        caseSensitive: params.case === "1",
        matches: params.limit,
        scope: scope.repoFilter ? [qRepo(scope.repoFilter)] : [],
        contexts: await this.contexts(),
      });
      // The scope node narrows the query; filtering the hits is the guarantee (P12).
      const files = r.files.filter((f) => scope.allows(f.repo));
      return files.length === r.files.length ? r : { ...r, files, fileCount: files.length, matchCount: files.reduce((n, f) => n + f.occurrences, 0) };
    } catch (e) {
      if (e instanceof QuerySyntaxError) throw error(400, "FAILED_TO_PARSE_QUERY", e.message);
      if (e instanceof SearchContextNotFoundError) throw error(404, "SEARCH_CONTEXT_NOT_FOUND", e.message);
      console.error("search failed", e instanceof Error ? e.message : e);
      throw error(502, "SEARCH_UNAVAILABLE", "Search is unavailable. Try again.");
    }
  }
}

@Controller("ui/products")
export class SearchController {
  constructor(@Inject(SearchService) private readonly searches: SearchService) {}

  @Get(":slug/search")
  get(@Param("slug") slug: string, @Query() query: unknown) {
    const p = searchQuerySchema.safeParse(query);
    if (!p.success) throw error(400, "INVALID_REQUEST_BODY", z.prettifyError(p.error));
    return this.searches.search(slug, p.data);
  }
}

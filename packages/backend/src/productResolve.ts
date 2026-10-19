// Context resolution shared by the backend sync (SearchContext and Product rows) and the api's admin writes.
// Kept free of the sync path's other imports so the api bundle only pulls micromatch and the Prisma types.
import micromatch from "micromatch";
import { RepoKind, type PrismaClient } from "@sbc/db";
import type { SearchContextConfig } from "@sbc/shared";

/** A Product's definition: a config context without its description. */
export type ProductDefinition = Omit<SearchContextConfig, "description">;
export interface ResolvableRepo {
  id: number;
  name: string;
  metadata: unknown;
}

/** Product slugs, checked at every entry point (path, admin API, config import). */
export const isProductSlug = (name: string) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);

const topicsOf = (m: unknown) => {
  const h = (m as { codeHostMetadata?: { gitlab?: { topics?: string[] }; github?: { topics?: string[] } } } | null)?.codeHostMetadata;
  return [...(h?.gitlab?.topics ?? []), ...(h?.github?.topics ?? [])].map((t) => t.toLowerCase());
};

/** Include globs / connections / topics, then excludes, over the code repos `all`. */
export function resolveContext(ctx: ProductDefinition, all: ResolvableRepo[], reposOf: (connections: string[]) => number[]): string[] {
  const ids: number[] = [];
  if (ctx.include) ids.push(...all.filter((r) => micromatch.isMatch(r.name, ctx.include!)).map((r) => r.id));
  if (ctx.includeConnections) ids.push(...reposOf(ctx.includeConnections));
  if (ctx.includeTopics) {
    const p = ctx.includeTopics.map((t) => t.toLowerCase());
    ids.push(...all.filter((r) => topicsOf(r.metadata).some((t) => micromatch.isMatch(t, p))).map((r) => r.id));
  }
  const byId = new Map(all.map((r) => [r.id, r]));
  let repos = [...new Set(ids)].map((id) => byId.get(id)!).filter(Boolean);
  if (ctx.exclude) repos = repos.filter((r) => !micromatch.isMatch(r.name, ctx.exclude!));
  if (ctx.excludeConnections) {
    const drop = new Set(reposOf(ctx.excludeConnections));
    repos = repos.filter((r) => !drop.has(r.id));
  }
  if (ctx.excludeTopics) {
    const p = ctx.excludeTopics.map((t) => t.toLowerCase());
    repos = repos.filter((r) => !topicsOf(r.metadata).some((t) => micromatch.isMatch(t, p)));
  }
  return repos.map((r) => r.name);
}

/** Reads code repos and connection membership once; the returned function resolves any number of definitions. */
export async function loadContextResolver(db: Pick<PrismaClient, "repo" | "connection">) {
  const all = await db.repo.findMany({ where: { kind: RepoKind.CODE }, select: { id: true, name: true, metadata: true } });
  const connections = await db.connection.findMany({ select: { name: true, repos: { select: { repoId: true } } } });
  const members = new Map(connections.map((c) => [c.name, c.repos.map((r) => r.repoId)]));
  const reposOf = (names: string[]) => names.flatMap((n) => members.get(n) ?? []);
  return (ctx: ProductDefinition) => resolveContext(ctx, all, reposOf);
}

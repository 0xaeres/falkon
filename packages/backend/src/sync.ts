import fs from "node:fs";
import { prisma, Prisma, ProductSource, RepoKind, type ConnectionType, type PrismaClient } from "@sbc/db";
import { KB_SUFFIX, ownerOfKnowledgeRepo, repoGitDir, repoPath, type Config, type ConnectionConfig } from "@sbc/shared";
import { compileConnection, dedupeRecords, type RepoRecord } from "./connectors";
import { isProductSlug, loadContextResolver, type ProductDefinition } from "./productResolve";
import { removeShards } from "./zoekt";

const connectionType = (c: ConnectionConfig): ConnectionType => c.type;

/** Mirrors config `connections` into the Connection table; dropped connections go with their links. */
export async function syncConnectionRows(cfg: Config) {
  const names = Object.keys(cfg.connections);
  for (const [name, config] of Object.entries(cfg.connections)) {
    await prisma.connection.upsert({
      where: { name },
      create: { name, connectionType: connectionType(config), config: config as unknown as Prisma.InputJsonValue },
      update: { connectionType: connectionType(config), config: config as unknown as Prisma.InputJsonValue },
    });
  }
  const dropped = await prisma.connection.deleteMany({ where: { name: { notIn: names } } });
  if (dropped.count) console.log(`removed ${dropped.count} connection(s) no longer in config`);
}

function repoData(r: RepoRecord) {
  return {
    name: r.name,
    displayName: r.displayName,
    cloneUrl: r.cloneUrl,
    webUrl: r.webUrl ?? null,
    imageUrl: r.imageUrl ?? null,
    // Hosts that do not report it leave the value learned from the last clone.
    ...(r.defaultBranch ? { defaultBranch: r.defaultBranch } : {}),
    isFork: r.isFork,
    isArchived: r.isArchived,
    isPublic: r.isPublic ?? false,
    metadata: r.metadata as Prisma.InputJsonValue,
    external_id: r.externalId,
    external_codeHostType: r.codeHostType,
    external_codeHostUrl: r.codeHostUrl,
  };
}

/**
 * One connection: list its repos, upsert each by (external id, code host), link them, and unlink
 * repos it no longer lists. Returns ids of repos to (re)index.
 */
export async function syncConnection(name: string, signal?: AbortSignal): Promise<number[]> {
  const conn = await prisma.connection.findUniqueOrThrow({ where: { name } });
  try {
    const records = dedupeRecords(await compileConnection(conn.config as unknown as ConnectionConfig, signal));
    const kept: number[] = [];
    for (const r of records) {
      if (ownerOfKnowledgeRepo(r.name) !== undefined) {
        console.warn(`ignoring repo "${r.name}": names ending in "${KB_SUFFIX}" are reserved for knowledge bases`);
        continue;
      }
      const clash = await prisma.repo.findUnique({ where: { name: r.name }, select: { external_id: true, external_codeHostUrl: true } });
      if (clash && (clash.external_id !== r.externalId || clash.external_codeHostUrl !== r.codeHostUrl)) {
        console.warn(`[${name}] skipping ${r.name}: another connection already provides a repo with this name`);
        continue;
      }
      const data = repoData(r);
      const repo = await prisma.repo.upsert({
        where: { external_id_external_codeHostUrl: { external_id: r.externalId, external_codeHostUrl: r.codeHostUrl } },
        create: { ...data, connections: { create: { connectionId: conn.id } } },
        update: data,
        select: { id: true },
      });
      await prisma.repoToConnection.upsert({
        where: { repoId_connectionId: { repoId: repo.id, connectionId: conn.id } },
        create: { repoId: repo.id, connectionId: conn.id },
        update: {},
      });
      kept.push(repo.id);
    }
    await prisma.repoToConnection.deleteMany({ where: { connectionId: conn.id, repoId: { notIn: kept } } });
    await prisma.connection.update({ where: { id: conn.id }, data: { syncedAt: new Date(), syncError: null } });
    console.log(`[${name}] ${kept.length} repo(s)`);
    return kept;
  } catch (e) {
    await prisma.connection.update({ where: { id: conn.id }, data: { syncError: String(e).slice(0, 2000) } });
    throw e;
  }
}

/** Remove a repo's generated knowledge base: its git repo, shards and citation index. */
export async function deleteKnowledge(ownerRepoId: number) {
  const k = await prisma.repo.findFirst({ where: { kind: RepoKind.KNOWLEDGE, ownerRepoId } });
  if (k) {
    removeShards(k.id);
    fs.rmSync(repoGitDir(k.name), { recursive: true, force: true });
    await prisma.repo.delete({ where: { id: k.id } });
  }
  await prisma.knowledgeDoc.deleteMany({ where: { repoId: ownerRepoId } });
}

/** Code repos no connection lists any more: shards, clone (never an in-place path) and rows go. */
export async function removeOrphans() {
  const orphans = await prisma.repo.findMany({ where: { kind: RepoKind.CODE, isAutoCleanupDisabled: false, connections: { none: {} } } });
  for (const r of orphans) {
    await deleteKnowledge(r.id);
    removeShards(r.id);
    const { path, isReadOnly } = repoPath(r);
    if (!isReadOnly) fs.rmSync(path, { recursive: true, force: true });
    await prisma.knowledgeScan.deleteMany({ where: { repoId: r.id } });
    await prisma.repo.delete({ where: { id: r.id } });
    console.log(`removed ${r.name}`);
  }
}

/** Resolves config `contexts` to repo names (include globs / connections / topics, then excludes); imports them as Products too. */
export async function syncSearchContexts(cfg: Config) {
  const resolve = await loadContextResolver(prisma);
  for (const [name, ctx] of Object.entries(cfg.contexts)) {
    const repoNames = resolve(ctx);
    await prisma.searchContext.upsert({
      where: { name },
      create: { name, description: ctx.description, repoNames },
      update: { description: ctx.description ?? null, repoNames },
    });
  }
  await prisma.searchContext.deleteMany({ where: { name: { notIn: Object.keys(cfg.contexts) } } });
  await syncProducts(cfg, resolve);
}

type ProductTable = Pick<PrismaClient["product"], "findMany" | "create" | "updateMany" | "deleteMany">;
const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/**
 * Config `contexts` become `source=config` Products; config Products no longer in config are deleted; `source=api`
 * Products are never written by the import except to re-resolve their own definition. A context whose name is not a
 * valid slug, or whose slug an api Product holds (api wins), is skipped with a log line. Every write is conditioned on
 * `source`, so a concurrent admin create cannot be turned into a config row.
 */
export async function syncProducts(cfg: Config, resolve: (d: ProductDefinition) => string[], products: ProductTable = prisma.product) {
  const imported: string[] = [];
  for (const [slug, { description, ...definition }] of Object.entries(cfg.contexts)) {
    if (!isProductSlug(slug)) {
      console.log(`product import: context "${slug}" skipped, not a valid Product slug (^[a-z0-9][a-z0-9-]{0,62}$)`);
      continue;
    }
    const data = { name: slug, description: description ?? null, definition: definition as Prisma.InputJsonValue, repoNames: resolve(definition) };
    const { count } = await products.updateMany({ where: { slug, source: ProductSource.config }, data });
    if (count === 0) {
      try {
        await products.create({ data: { slug, source: ProductSource.config, ...data } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        console.log(`product import: context "${slug}" skipped, an api Product has that slug`);
        continue;
      }
    }
    imported.push(slug);
  }
  await products.deleteMany({ where: { source: ProductSource.config, slug: { notIn: imported } } });
  for (const p of await products.findMany({ where: { source: ProductSource.api } })) {
    const repoNames = resolve(p.definition as ProductDefinition);
    if (JSON.stringify(repoNames) !== JSON.stringify(p.repoNames)) await products.updateMany({ where: { id: p.id, source: ProductSource.api, updatedAt: p.updatedAt }, data: { repoNames } });
  }
}

import fs from "node:fs";
import { prisma, ConnectionSource, Prisma, RepoKind, type ConnectionType, type PrismaClient } from "@falkon/db";
import { KB_SUFFIX, ownerOfKnowledgeRepo, repoGitDir, repoPath, type Config, type ConnectionConfig } from "@falkon/shared";
import { compileConnection, dedupeRecords, type RepoRecord } from "./connectors";
import type { ProductDefinition } from "./productResolve";
import { removeShards } from "./zoekt";

const connectionType = (c: ConnectionConfig): ConnectionType => c.type;

type ConnectionTable = Pick<PrismaClient["connection"], "findMany" | "upsert" | "updateMany" | "deleteMany">;
type RepoTable = Pick<PrismaClient["repo"], "findMany" | "updateMany">;

/**
 * Mirrors config `connections` into the Connection table as `source=config` rows; config rows no longer in config go
 * with their links. `source=api` rows are never written or deleted here: a config connection with an api row's name
 * is skipped (api wins).
 */
export async function syncConnectionRows(cfg: Config, connections: ConnectionTable = prisma.connection) {
  const apiNames = new Set((await connections.findMany({ where: { source: ConnectionSource.api }, select: { name: true } })).map((c) => c.name));
  const names = Object.keys(cfg.connections).filter((name) => {
    if (apiNames.has(name)) console.log(`connection "${name}" skipped, an api connection has that name`);
    return !apiNames.has(name);
  });
  for (const name of names) {
    const config = cfg.connections[name]!;
    await connections.upsert({
      where: { name },
      create: { name, connectionType: connectionType(config), config: config as unknown as Prisma.InputJsonValue },
      update: { connectionType: connectionType(config), config: config as unknown as Prisma.InputJsonValue },
    });
  }
  const dropped = await connections.deleteMany({ where: { source: ConnectionSource.config, name: { notIn: names } } });
  if (dropped.count) console.log(`removed ${dropped.count} connection(s) no longer in config`);
}

/**
 * Names of connections whose sync was requested (by the api). Each is claimed with exactly the value read, so two
 * ticks never both win and a newer request written meanwhile stays for the next tick.
 */
export async function claimSyncRequests(connections: ConnectionTable = prisma.connection): Promise<string[]> {
  const claimed: string[] = [];
  for (const c of await connections.findMany({ where: { syncRequestedAt: { not: null } }, select: { id: true, name: true, syncRequestedAt: true } })) {
    const { count } = await connections.updateMany({ where: { id: c.id, syncRequestedAt: c.syncRequestedAt }, data: { syncRequestedAt: null } });
    if (count) claimed.push(c.name);
  }
  return claimed;
}

/** Ids of repos whose index was requested (retry), claimed like `claimSyncRequests`. */
export async function claimIndexRequests(repos: RepoTable = prisma.repo): Promise<number[]> {
  const claimed: number[] = [];
  for (const r of await repos.findMany({ where: { indexRequestedAt: { not: null } }, select: { id: true, indexRequestedAt: true } })) {
    const { count } = await repos.updateMany({ where: { id: r.id, indexRequestedAt: r.indexRequestedAt }, data: { indexRequestedAt: null } });
    if (count) claimed.push(r.id);
  }
  return claimed;
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

/** Config `contexts` no longer create Products (they come only from /setup): a file that still has them gets one line per load. */
export function noticeIgnoredContexts(cfg: Config, log: (line: string) => void = console.log) {
  if (cfg.contextsIgnored) log("config: `contexts` is ignored; Products are now created in /setup");
}

type ProductTable = Pick<PrismaClient["product"], "findMany" | "updateMany">;

/**
 * Re-resolves every Product's `repoNames` from its own definition (repositories and connections change under it). A write
 * is conditioned on `updatedAt`, so a row a UI write changed since it was read is left for the next round.
 */
export async function resolveProducts(resolve: (d: ProductDefinition) => string[], products: ProductTable = prisma.product) {
  for (const p of await products.findMany()) {
    const repoNames = resolve(p.definition as ProductDefinition);
    if (JSON.stringify(repoNames) !== JSON.stringify(p.repoNames)) await products.updateMany({ where: { id: p.id, updatedAt: p.updatedAt }, data: { repoNames } });
  }
}

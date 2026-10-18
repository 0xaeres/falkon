import fs from "node:fs";
import micromatch from "micromatch";
import { prisma, Prisma, RepoKind, type ConnectionType } from "@sbc/db";
import { KB_SUFFIX, ownerOfKnowledgeRepo, repoGitDir, repoPath, type Config, type ConnectionConfig } from "@sbc/shared";
import { compileConnection, dedupeRecords, type RepoMetadata, type RepoRecord } from "./connectors";
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

/** Resolves config `contexts` to repo names (include globs / connections / topics, then excludes). */
export async function syncSearchContexts(cfg: Config) {
  const all = await prisma.repo.findMany({ where: { kind: RepoKind.CODE }, select: { id: true, name: true, metadata: true } });
  const reposOf = async (names: string[]) =>
    (await prisma.connection.findMany({ where: { name: { in: names } }, include: { repos: { select: { repoId: true } } } })).flatMap((c) =>
      c.repos.map((r) => r.repoId),
    );
  const topicsOf = (m: unknown) => {
    const h = (m as RepoMetadata)?.codeHostMetadata;
    return [...(h?.gitlab?.topics ?? []), ...(h?.github?.topics ?? [])].map((t) => t.toLowerCase());
  };
  for (const [name, ctx] of Object.entries(cfg.contexts)) {
    let ids: number[] = [];
    if (ctx.include) ids.push(...all.filter((r) => micromatch.isMatch(r.name, ctx.include!)).map((r) => r.id));
    if (ctx.includeConnections) ids.push(...(await reposOf(ctx.includeConnections)));
    if (ctx.includeTopics) {
      const p = ctx.includeTopics.map((t) => t.toLowerCase());
      ids.push(...all.filter((r) => topicsOf(r.metadata).some((t) => micromatch.isMatch(t, p))).map((r) => r.id));
    }
    const byId = new Map(all.map((r) => [r.id, r]));
    let repos = [...new Set(ids)].map((id) => byId.get(id)!).filter(Boolean);
    if (ctx.exclude) repos = repos.filter((r) => !micromatch.isMatch(r.name, ctx.exclude!));
    if (ctx.excludeConnections) {
      const drop = new Set(await reposOf(ctx.excludeConnections));
      repos = repos.filter((r) => !drop.has(r.id));
    }
    if (ctx.excludeTopics) {
      const p = ctx.excludeTopics.map((t) => t.toLowerCase());
      repos = repos.filter((r) => !topicsOf(r.metadata).some((t) => micromatch.isMatch(t, p)));
    }
    const repoNames = repos.map((r) => r.name);
    await prisma.searchContext.upsert({
      where: { name },
      create: { name, description: ctx.description, repoNames },
      update: { description: ctx.description ?? null, repoNames },
    });
  }
  await prisma.searchContext.deleteMany({ where: { name: { notIn: Object.keys(cfg.contexts) } } });
}

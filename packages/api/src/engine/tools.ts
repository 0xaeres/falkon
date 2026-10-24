import { prisma, RepoKind, type Repo } from "@falkon/db";
import { createToolRunner, env, gitDirOf, postgresProvenanceStore, repoPath, type ToolDeps, type ToolRepo } from "@falkon/shared";
import "./repos";

const toToolRepo = (r: Repo): ToolRepo => ({
  id: r.id,
  name: r.name,
  displayName: r.displayName,
  codeHostType: r.external_codeHostType,
  webUrl: r.webUrl,
  defaultBranch: r.defaultBranch,
  isFork: r.isFork,
  isArchived: r.isArchived,
  pushedAt: r.pushedAt,
  indexedAt: r.lastIndexedAt,
  indexedRevisions: ((r.metadata as { indexedRevisions?: string[] } | null)?.indexedRevisions ?? []),
  path: gitDirOf(repoPath(r).path),
});

export const toolDeps: ToolDeps = {
  async getRepo(name) {
    const r = await prisma.repo.findUnique({ where: { name } });
    return r ? toToolRepo(r) : undefined;
  },
  async listRepos({ query, sort, direction }) {
    const rows = await prisma.repo.findMany({
      where: { kind: RepoKind.CODE, ...(query ? { name: { contains: query, mode: "insensitive" } } : {}) },
      orderBy: { [sort === "pushed" ? "pushedAt" : "name"]: direction },
    });
    return rows.map(toToolRepo);
  },
  // Read by the history tools only, which register only with MCP_HISTORY_TOOLS=on.
  history: postgresProvenanceStore(prisma),
  syncIntervalMs: env.discussionSyncIntervalMs,
};

export const runTool = createToolRunner(toolDeps);

/** Set by main.ts: the Product's current generation id, or "" when none is published. The default serves callers that have no Product service (the legacy web app). Lives here so setting it does not load the `ai` SDK. */
export const productDeps = { generation: async (_product: string): Promise<string> => "" };

import fs from "node:fs";
import micromatch from "micromatch";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma, RepoKind, RepoStatus, ScanStatus } from "@sbc/db";
import { env, KB_SUFFIX, loadConfig, ownerOfKnowledgeRepo, repoGitDir } from "@sbc/shared";
import { resolveConnections } from "./connections";
import { syncRepo } from "./git";
import { indexRepo, removeShards, writeZoektGitConfig } from "./zoekt";
import { kbSelected, runKnowledgeScan } from "./kb/scan";

const QUEUE = "repo-sync";
const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue<{ repoId: number }>(QUEUE, {
  connection,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100, attempts: 2, backoff: { type: "exponential", delay: 10_000 } },
});

/** Reconcile DB with config.json, then enqueue a sync for every repo. */
async function reconcile() {
  const cfg = loadConfig(env.configPath);
  const specs = await resolveConnections(cfg.connections);
  const names = new Set(specs.map((s) => s.name));

  for (const s of specs) {
    if (ownerOfKnowledgeRepo(s.name) !== undefined) {
      console.warn(`ignoring repo "${s.name}": names ending in "${KB_SUFFIX}" are reserved for knowledge bases`);
      continue;
    }
    const data = {
      cloneUrl: s.cloneUrl,
      tokenEnv: s.tokenEnv,
      indexBranches: s.branches,
      indexTags: s.tags,
      isFork: s.isFork ?? false,
      isArchived: s.isArchived ?? false,
      isPublic: s.isPublic ?? false,
      webUrl: s.webUrl,
    };
    const repo = await prisma.repo.upsert({
      where: { name: s.name },
      create: { name: s.name, ...data },
      update: data,
    });
    // jobId dedupes: a repo already queued is not queued twice
    await queue.add("sync", { repoId: repo.id }, { jobId: `sync-${repo.id}-${Math.floor(Date.now() / 60_000)}` });
  }

  for (const r of await prisma.repo.findMany({ where: { kind: RepoKind.CODE, name: { notIn: [...names] } } })) {
    await deleteKnowledge(r.id);
    removeShards(r.id);
    fs.rmSync(repoGitDir(r.name), { recursive: true, force: true });
    await prisma.knowledgeScan.deleteMany({ where: { repoId: r.id } });
    await prisma.repo.delete({ where: { id: r.id } });
    console.log(`removed ${r.name}`);
  }
  return cfg.resyncIntervalMinutes;
}

/** Remove a repo's generated knowledge base: its git repo, shards and citation index. */
async function deleteKnowledge(ownerRepoId: number) {
  const k = await prisma.repo.findFirst({ where: { kind: RepoKind.KNOWLEDGE, ownerRepoId } });
  if (k) {
    removeShards(k.id);
    fs.rmSync(repoGitDir(k.name), { recursive: true, force: true });
    await prisma.repo.delete({ where: { id: k.id } });
  }
  await prisma.knowledgeDoc.deleteMany({ where: { repoId: ownerRepoId } });
}

// zoekt indexes at most 64 branches/tags per repo.
const MAX_REVISIONS = 64;

/** Default branch first (searchable as HEAD), then branches/tags matching the configured globs. */
function pickRevisions(meta: { defaultBranch: string | null; branches: string[]; tags: string[] }, branchGlobs: string[], tagGlobs: string[]) {
  const revs = [meta.defaultBranch ? `refs/heads/${meta.defaultBranch}` : "HEAD"];
  if (branchGlobs.length) revs.push(...micromatch(meta.branches, branchGlobs).map((b) => `refs/heads/${b}`));
  if (tagGlobs.length) revs.push(...micromatch(meta.tags, tagGlobs).map((t) => `refs/tags/${t}`));
  const unique = [...new Set(revs)];
  if (unique.length > MAX_REVISIONS) console.warn(`truncating ${unique.length} revisions to ${MAX_REVISIONS}`);
  return unique.slice(0, MAX_REVISIONS);
}

const worker = new Worker<{ repoId: number }>(
  QUEUE,
  async (job) => {
    const repo = await prisma.repo.findUniqueOrThrow({ where: { id: job.data.repoId } });
    await prisma.repo.update({ where: { id: repo.id }, data: { status: "SYNCING", error: null } });
    try {
      const dir = repoGitDir(repo.name);
      if (repo.kind === RepoKind.KNOWLEDGE) {
        // generated locally: nothing to clone or fetch, just (re)index main
        await writeZoektGitConfig(dir, repo);
        await indexRepo(repo.id, dir, ["refs/heads/main"]);
        if (!(await prisma.repo.findUnique({ where: { id: repo.id }, select: { id: true } }))) {
          removeShards(repo.id);
          return;
        }
        await prisma.repo.update({ where: { id: repo.id }, data: { status: RepoStatus.INDEXED, defaultBranch: "main", branches: ["main"], lastIndexedAt: new Date() } });
        console.log(`indexed ${repo.name}`);
        return;
      }
      const token = repo.tokenEnv ? process.env[repo.tokenEnv] : undefined;
      const meta = await syncRepo(dir, repo.cloneUrl, token);
      const revisions = pickRevisions(meta, repo.indexBranches, repo.indexTags);
      await writeZoektGitConfig(dir, repo);
      await indexRepo(repo.id, dir, revisions);
      // The repo may have been removed from config while we were indexing. Its row is gone, so
      // reconcile will never clean up the shards we just wrote; do it here.
      if (!(await prisma.repo.findUnique({ where: { id: repo.id }, select: { id: true } }))) {
        removeShards(repo.id);
        fs.rmSync(dir, { recursive: true, force: true });
        return;
      }
      await prisma.repo.update({
        where: { id: repo.id },
        data: {
          status: "INDEXED",
          defaultBranch: meta.defaultBranch,
          headCommit: meta.headCommit,
          branches: meta.branches,
          pushedAt: meta.pushedAt,
          lastIndexedAt: new Date(),
        },
      });
      console.log(`indexed ${repo.name}`);
    } catch (e) {
      await prisma.repo.update({ where: { id: repo.id }, data: { status: "FAILED", error: String(e).slice(0, 2000) } });
      throw e;
    }
  },
  { connection, concurrency: 2 },
);
worker.on("failed", (job, err) => console.error(`job ${job?.id} failed: ${err.message}`));

// ---- knowledge base ---------------------------------------------------------------

const kbQueue = new Queue<{ repoId: number; manual: boolean }>("kb-scan", {
  connection,
  // history lives in the KnowledgeScan table; retained jobs would block a retry that reuses the same job id
  defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
});

const kbWorker = new Worker<{ repoId: number; manual: boolean }>(
  "kb-scan",
  async (job) => {
    const result = await runKnowledgeScan(job.data.repoId, { manual: job.data.manual, log: (m) => console.log(`[kb ${job.data.repoId}] ${m}`) });
    if (!result) return;
    console.log(`[kb ${job.data.repoId}] scan ${result.scanId} ${result.status}`);
    if (result.needsIndex) await queue.add("sync", { repoId: result.knowledgeRepoId }, { jobId: `sync-${result.knowledgeRepoId}-${Date.now()}` });
  },
  { connection, concurrency: 1, lockDuration: 10 * 60_000 },
);
kbWorker.on("failed", (job, err) => console.error(`kb job ${job?.id} failed: ${err.message}`));

/** Applies web-app requests (scan now / delete / re-include) and schedules due scans. */
async function kbTick() {
  let cfg;
  try {
    cfg = loadConfig(env.configPath).knowledgeBase;
  } catch {
    return;
  }
  const now = Date.now();
  // knowledge repos whose new commits were never indexed (e.g. a crash between a scan and its hand-off)
  for (const k of await prisma.repo.findMany({ where: { kind: RepoKind.KNOWLEDGE, status: RepoStatus.PENDING } })) {
    await queue.add("sync", { repoId: k.id }, { jobId: `sync-${k.id}-${Math.floor(now / 60_000)}` });
  }
  for (const r of await prisma.repo.findMany({ where: { kind: RepoKind.CODE } })) {
    if (r.kbRequest) {
      const req = r.kbRequest;
      // a delete must not race a running scan, which would write the documents straight back
      if (req === "delete" && (await prisma.knowledgeScan.findFirst({ where: { repoId: r.id, status: ScanStatus.RUNNING }, select: { id: true } }))) continue;
      // claim exactly the request we read; a newer one written meanwhile stays for the next tick
      const claimed = await prisma.repo.updateMany({ where: { id: r.id, kbRequest: req }, data: { kbRequest: null, kbRequestedAt: null } });
      if (claimed.count === 0) continue;
      if (req === "delete") {
        await deleteKnowledge(r.id);
        await prisma.repo.update({ where: { id: r.id }, data: { kbExcluded: true, kbScannedCommit: null, kbLastFullScanAt: null } });
      } else if (req === "include") {
        await prisma.repo.update({ where: { id: r.id }, data: { kbExcluded: false } });
      } else if (req === "scan" && kbSelected(cfg, r)) {
        await kbQueue.add("scan", { repoId: r.id, manual: true }, { jobId: `kb-${r.id}-manual-${now}` });
      }
      continue;
    }
    if (!kbSelected(cfg, r) || r.status !== RepoStatus.INDEXED || !r.headCommit || r.kbScannedCommit === r.headCommit) continue;
    const last = await prisma.knowledgeScan.findFirst({ where: { repoId: r.id }, orderBy: { startedAt: "desc" } });
    if (last?.status === ScanStatus.RUNNING) continue;
    if (last && now - last.startedAt.getTime() < cfg.refreshIntervalHours * 3_600_000) continue;
    await kbQueue.add("scan", { repoId: r.id, manual: false }, { jobId: `kb-${r.id}-${r.headCommit}` });
  }
}

async function loop() {
  let minutes = 60;
  try {
    minutes = await reconcile();
  } catch (e) {
    console.error("reconcile failed:", e);
  }
  setTimeout(loop, minutes * 60_000);
}

loop();
// a scan interrupted by a crash or restart never finishes; close it out so the scheduler can retry
prisma.knowledgeScan
  .updateMany({ where: { status: ScanStatus.RUNNING }, data: { status: ScanStatus.FAILED, error: "interrupted by restart", finishedAt: new Date() } })
  .catch((e) => console.error("scan cleanup failed:", e));
setInterval(() => kbTick().catch((e) => console.error("kb tick failed:", e)), 30_000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await worker.close();
    await kbWorker.close();
    await queue.close();
    await kbQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

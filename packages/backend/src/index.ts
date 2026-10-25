import fs from "node:fs";
import micromatch from "micromatch";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma, ConnectionSource, RepoKind, RepoStatus, ScanStatus } from "@falkon/db";
import { DEFAULT_SETTINGS, env, gitDirOf, loadConfig, openCredential, parseTicketKeys, postgresProvenanceStore, redisSignals, repoGitDir, repoPath, resolveEnvironmentOverrides, setCredentialResolver, type Config, type SyncState } from "@falkon/shared";
import type { RepoMetadata } from "./connectors";
import { credentialsFor } from "./credentials";
import { cloneOrFetch, localDefaultBranch, repoStats, sortedRefs, upsertGitConfig } from "./git";
import { claimIndexRequests, claimSyncRequests, deleteKnowledge, removeOrphans, syncConnection, syncConnectionRows, syncSearchContexts } from "./sync";
import { indexRepo, removeShards, writeZoektGitConfig } from "./zoekt";
import { kbModelReady, kbSelected, runKnowledgeScan } from "./kb/scan";
import { importDiscussions, snapshotSource } from "./discussions";
import { discussionConnection, planDiscussionSync, runDiscussionJob } from "./discussionSchedule";
import { githubSource, githubTransport } from "./githubDiscussions";
import { announceJobs, coalesce } from "./requests";

const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
// Pings to and from the api (D155): `changed` out after jobs and claims, `request` in when the api wrote a row to claim.
const signals = redisSignals();

// `{ stored }` tokens (source=api connections) are opened from the Credential table.
setCredentialResolver(async (id) => openCredential(await prisma.credential.findUniqueOrThrow({ where: { id } })));

let cfg: Config | undefined;
let settings = DEFAULT_SETTINGS;

async function reloadConfig() {
  cfg = await loadConfig(env.configPath);
  settings = cfg.settings;
  Object.assign(process.env, await resolveEnvironmentOverrides(cfg));
  // BullMQ applies a new concurrency to the running worker.
  connWorker.concurrency = settings.maxConnectionSyncJobConcurrency;
  worker.concurrency = settings.maxRepoIndexingJobConcurrency;
  return cfg;
}

// ---- connection sync -----------------------------------------------------------------

const connQueue = new Queue<{ name: string }>("connection-sync", {
  connection,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100, attempts: 1 },
});
const indexQueue = new Queue<{ repoId: number }>("repo-index", {
  connection,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100, attempts: 2, backoff: { type: "exponential", delay: 10_000 } },
});

const enqueueIndex = (repoId: number) =>
  // jobId dedupes: a repo already waiting is not queued twice
  indexQueue.add("index", { repoId }, { jobId: `index-${repoId}-${Math.floor(Date.now() / 60_000)}` });

let pendingConnections = 0;
const connWorker = new Worker<{ name: string }>(
  "connection-sync",
  async (job) => {
    const ids = await syncConnection(job.data.name);
    // New repos index right away; known ones wait for the reindex schedule.
    const fresh = await prisma.repo.findMany({ where: { id: { in: ids }, lastIndexedAt: null }, select: { id: true } });
    for (const r of fresh) await enqueueIndex(r.id);
  },
  { connection, concurrency: DEFAULT_SETTINGS.maxConnectionSyncJobConcurrency },
);
connWorker.on("failed", (job, err) => console.error(`connection ${job?.data.name} sync failed: ${err.message}`));
connWorker.on("completed", () => afterConnectionJob());
connWorker.on("failed", () => afterConnectionJob());

/** Once a round of connection syncs drains: drop orphaned repos and recompute contexts. */
async function afterConnectionJob() {
  if (--pendingConnections > 0 || !cfg) return;
  try {
    await removeOrphans();
    await syncSearchContexts(cfg);
  } catch (e) {
    console.error("post-sync cleanup failed:", e);
  }
  signals.changed();
}

async function syncAllConnections() {
  const c = await reloadConfig();
  await syncConnectionRows(c);
  const names = Object.keys(c.connections);
  if (names.length === 0) {
    pendingConnections = 1;
    return afterConnectionJob();
  }
  pendingConnections += names.length;
  for (const name of names) await connQueue.add("sync", { name }, { jobId: `sync-${name}-${Date.now()}` });
}

// ---- repo indexing -------------------------------------------------------------------

const MAX_REVISIONS = 64; // zoekt's limit per repo

/** Default branch first (searchable as HEAD), then matching branches newest first, then matching tags. */
async function pickRevisions(dir: string, meta: RepoMetadata) {
  const def = await localDefaultBranch(dir);
  let revs = [def ? (def.startsWith("refs/") ? def : `refs/heads/${def}`) : "HEAD"];
  if (meta.branches) revs.push(...(await sortedRefs(dir, "refs/heads")).filter((b) => micromatch.isMatch(b, meta.branches!)).map((b) => `refs/heads/${b}`));
  if (meta.tags) revs.push(...(await sortedRefs(dir, "refs/tags")).filter((t) => micromatch.isMatch(t, meta.tags!)).map((t) => `refs/tags/${t}`));
  revs = [...new Set(revs)];
  if (revs.length > MAX_REVISIONS) console.warn(`truncating ${revs.length} revisions to ${MAX_REVISIONS}`);
  return { revisions: revs.slice(0, MAX_REVISIONS), defaultBranch: def };
}

const worker = new Worker<{ repoId: number }>(
  "repo-index",
  async (job) => {
    const repo = await prisma.repo.findUnique({ where: { id: job.data.repoId }, include: { connections: { include: { connection: true } } } });
    if (!repo) return;
    await prisma.repo.update({ where: { id: repo.id }, data: { status: "SYNCING", error: null } });
    const signal = AbortSignal.timeout(settings.repoIndexTimeoutMs);
    try {
      if (repo.kind === RepoKind.KNOWLEDGE) {
        // generated locally: nothing to clone or fetch, just (re)index main
        const dir = repoGitDir(repo.name);
        await writeZoektGitConfig(dir, repo);
        await indexRepo(repo.id, repo.name, dir, ["refs/heads/main"], signal, settings);
        if (!(await prisma.repo.findUnique({ where: { id: repo.id }, select: { id: true } }))) {
          removeShards(repo.id);
          return;
        }
        await prisma.repo.update({ where: { id: repo.id }, data: { status: RepoStatus.INDEXED, defaultBranch: "main", branches: ["main"], lastIndexedAt: new Date() } });
        console.log(`indexed ${repo.name}`);
        return;
      }
      const meta = (repo.metadata ?? {}) as RepoMetadata;
      const { path, isReadOnly } = repoPath(repo);
      if (!isReadOnly) {
        const creds = await credentialsFor(repo.external_codeHostType, repo.connections.map((c) => c.connection));
        await cloneOrFetch(path, repo.cloneUrl, creds, signal);
        if (meta.gitConfig) await upsertGitConfig(path, meta.gitConfig);
      }
      const dir = gitDirOf(path);
      const { revisions, defaultBranch } = await pickRevisions(dir, meta);
      await indexRepo(repo.id, repo.name, dir, revisions, signal, settings);
      // The repo may have been dropped from config while we were indexing. Its row is gone, so
      // cleanup will never find the shards we just wrote; do it here.
      if (!(await prisma.repo.findUnique({ where: { id: repo.id }, select: { id: true } }))) {
        removeShards(repo.id);
        if (!isReadOnly) fs.rmSync(path, { recursive: true, force: true });
        return;
      }
      const stats = await repoStats(dir);
      await prisma.repo.update({
        where: { id: repo.id },
        data: {
          status: "INDEXED",
          // From the clone's HEAD: null for a detached HEAD.
          defaultBranch: defaultBranch ?? null,
          headCommit: stats.headCommit,
          branches: stats.branches,
          pushedAt: stats.pushedAt,
          lastIndexedAt: new Date(),
          // list_branches reports which branches search can see.
          metadata: { ...meta, indexedRevisions: revisions } as object,
        },
      });
      console.log(`indexed ${repo.name}`);
      if (discussionSource) await discussionQueue.add("import", { repoId: repo.id }, { jobId: `discussions-${repo.id}` });
    } catch (e) {
      await prisma.repo.update({ where: { id: repo.id }, data: { status: "FAILED", error: String(e).slice(0, 2000) } }).catch(() => {});
      throw e;
    }
  },
  { connection, concurrency: DEFAULT_SETTINGS.maxRepoIndexingJobConcurrency },
);
worker.on("failed", (job, err) => console.error(`index job ${job?.id} failed: ${err.message}`));

/** Reindex repos whose last index is older than reindexIntervalMs; resync connections past resyncConnectionIntervalMs. */
async function scheduleTick() {
  const now = Date.now();
  const due = await prisma.repo.findMany({
    where: { kind: RepoKind.CODE, OR: [{ lastIndexedAt: null }, { lastIndexedAt: { lt: new Date(now - settings.reindexIntervalMs) } }] },
    select: { id: true },
  });
  for (const r of due) await enqueueIndex(r.id);
  // source=api connections sync when requested; the config resync below covers config connections only
  const stale = await prisma.connection.findFirst({ where: { source: ConnectionSource.config, OR: [{ syncedAt: null }, { syncedAt: { lt: new Date(now - settings.resyncConnectionIntervalMs) } }] } });
  if (stale && pendingConnections <= 0) await syncAllConnections();
  claimRequests();
}

/**
 * Takes the UI's requests (sync, retry, knowledge base actions) at once. Runs on the api's request signal and on every tick, so a
 * request written while the signal was lost is still taken; a trigger during a run is folded into one more pass.
 */
const claimRequests = coalesce(async () => {
  let claimed = 0;
  for (const name of await claimSyncRequests()) {
    claimed++;
    pendingConnections += 1;
    await connQueue.add("sync", { name }, { jobId: `sync-${name}-${Date.now()}` });
  }
  // a requested retry must not be deduped against the failed job of the same minute
  for (const repoId of await claimIndexRequests()) {
    claimed++;
    await indexQueue.add("index", { repoId }, { jobId: `index-${repoId}-retry-${Date.now()}` });
  }
  claimed += await kbRequests();
  if (claimed) signals.changed();
}, (e) => console.error("claiming requests failed:", e));

// ---- pull requests (ADR 0001, 4.11) ----------------------------------------------------------------

// The recorded snapshot is the only source this cycle (D107); the live GitHub adapter plugs into the same job.
const discussionSource = process.env.DISCUSSIONS_SNAPSHOT_DIR ? snapshotSource(process.env.DISCUSSIONS_SNAPSHOT_DIR) : undefined;
const discussionQueue = new Queue<{ repoId: number }>("discussion-import", {
  connection,
  // jobId dedupes a repository already waiting; history lives in DiscussionSyncState
  defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
});
const discussionWorker = new Worker<{ repoId: number }>(
  "discussion-import",
  async (job) => {
    const repo = await prisma.repo.findUnique({ where: { id: job.data.repoId } });
    if (!repo || !discussionSource) return;
    const r = await importDiscussions(postgresProvenanceStore(prisma), discussionSource, { id: repo.id, name: repo.name, dir: gitDirOf(repoPath(repo).path), head: repo.headCommit }, parseTicketKeys(process.env.DISCUSSION_TICKET_KEYS));
    if (r) console.log(`discussions ${repo.name}: ${r.imported} imported, ${r.skipped} skipped (${r.total} stored), ${r.commitLinks ?? "unchanged"} commit links, ${r.ms} ms`);
  },
  { connection, concurrency: 1, lockDuration: 10 * 60_000 },
);
discussionWorker.on("failed", (job, err) => console.error(`discussion import ${job?.data.repoId} failed: ${err.message}`));

// The live GitHub sync (D116, D123). The snapshot directory wins: with it set no live job is enqueued or run.
type SyncJobData = { repoId: number; reconcile: boolean };
const syncQueue = new Queue<SyncJobData>("discussion-sync", {
  connection,
  // completed ids stay for an hour so a second backend process cannot enqueue the same interval's job again
  defaultJobOptions: { removeOnComplete: { age: 3600 }, removeOnFail: { age: 3600 }, attempts: 1 },
});
const syncWorker = new Worker<SyncJobData>(
  "discussion-sync",
  async (job) => {
    if (discussionSource) return;
    const repo = await prisma.repo.findUnique({ where: { id: job.data.repoId }, include: { connections: { include: { connection: true } } } });
    if (!repo?.headCommit) return;
    await runDiscussionJob({
      store: postgresProvenanceStore(prisma),
      target: { id: repo.id, name: repo.name, dir: gitDirOf(repoPath(repo).path), head: repo.headCommit },
      // read as the job starts: a flag turned off since the enqueue ends the job, and one already running finishes
      conn: discussionConnection(repo.connections.map((c) => c.connection)),
      reconcile: job.data.reconcile,
      makeSource: async (conn, reconcile) => githubSource({ transport: await githubTransport(conn), backfillMonths: settings.discussionBackfillMonths, reconcile }),
      requeue: async (data, jobId, delay) => void (await syncQueue.add("sync", data, { jobId, delay })),
      ticketKeys: parseTicketKeys(process.env.DISCUSSION_TICKET_KEYS),
    });
  },
  { connection, concurrency: 1, lockDuration: 10 * 60_000 },
);
// fixed text only: neither the token nor GitHub's words reach the log
syncWorker.on("failed", (job) => console.error(`discussion sync ${job?.data.repoId} failed`));

const narrowState = <T extends { status: string; access: string }>(s: T) => ({ ...s, status: s.status as SyncState["status"], access: s.access as SyncState["access"] });

/** Enqueues the repositories due for a live sync, a bounded number per tick, oldest run first. */
async function discussionTick() {
  if (discussionSource) return;
  const repos = await prisma.repo.findMany({
    where: { kind: RepoKind.CODE, status: RepoStatus.INDEXED, headCommit: { not: null } },
    select: { id: true, headCommit: true, connections: { select: { connection: { select: { config: true } } } } },
  });
  const states = new Map((await prisma.discussionSyncState.findMany({ where: { repoId: { in: repos.map((r) => r.id) } }, select: { repoId: true, status: true, lastRunAt: true, waitUntil: true, access: true, reconciledAt: true } })).map((s) => [s.repoId, s]));
  const jobs = planDiscussionSync(
    repos.map((r) => ({ id: r.id, indexed: true, headCommit: r.headCommit, connections: r.connections.map((c) => c.connection), state: states.get(r.id) && narrowState(states.get(r.id)!) })),
    { now: new Date(), intervalMs: settings.discussionSyncIntervalMs, reconcileMs: settings.discussionReconcileIntervalMs, snapshot: false },
  );
  for (const j of jobs) await syncQueue.add("sync", { repoId: j.repoId, reconcile: j.reconcile }, { jobId: j.jobId });
}

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
    if (result.needsIndex) await indexQueue.add("index", { repoId: result.knowledgeRepoId }, { jobId: `index-${result.knowledgeRepoId}-${Date.now()}` });
  },
  { connection, concurrency: 1, lockDuration: 10 * 60_000 },
);
kbWorker.on("failed", (job, err) => console.error(`kb job ${job?.id} failed: ${err.message}`));

/** Applies web-app requests (scan now / delete / re-include); returns how many it claimed. */
async function kbRequests(): Promise<number> {
  if (!cfg) return 0;
  const kbCfg = cfg.knowledgeBase;
  // a disabled knowledge base never logs the no-model line (kbSelected is false for every repo then)
  const modelReady = !kbCfg.enabled || kbModelReady();
  let taken = 0;
  for (const r of await prisma.repo.findMany({ where: { kind: RepoKind.CODE, kbRequest: { not: null } } })) {
    const req = r.kbRequest!;
    // keep a scan request until a model exists; delete and include need none
    if (req === "scan" && !modelReady) continue;
    // a delete must not race a running scan, which would write the documents straight back
    if (req === "delete" && (await prisma.knowledgeScan.findFirst({ where: { repoId: r.id, status: ScanStatus.RUNNING }, select: { id: true } }))) continue;
    // claim exactly the request we read; a newer one written meanwhile stays for the next pass
    const claimed = await prisma.repo.updateMany({ where: { id: r.id, kbRequest: req }, data: { kbRequest: null, kbRequestedAt: null } });
    if (claimed.count === 0) continue;
    taken++;
    if (req === "delete") {
      await deleteKnowledge(r.id);
      await prisma.repo.update({ where: { id: r.id }, data: { kbExcluded: true, kbScannedCommit: null, kbLastFullScanAt: null } });
    } else if (req === "include") {
      await prisma.repo.update({ where: { id: r.id }, data: { kbExcluded: false } });
    } else if (req === "scan" && kbSelected(kbCfg, r)) {
      await kbQueue.add("scan", { repoId: r.id, manual: true }, { jobId: `kb-${r.id}-manual-${Date.now()}` });
    }
  }
  return taken;
}

/** Schedules due scans; requests are taken by `claimRequests` (from `scheduleTick`). */
async function kbTick() {
  if (!cfg) return;
  const kbCfg = cfg.knowledgeBase;
  const now = Date.now();
  const modelReady = !kbCfg.enabled || kbModelReady();
  // knowledge repos whose new commits were never indexed (e.g. a crash between a scan and its hand-off)
  for (const k of await prisma.repo.findMany({ where: { kind: RepoKind.KNOWLEDGE, status: RepoStatus.PENDING } })) {
    await enqueueIndex(k.id);
  }
  for (const r of await prisma.repo.findMany({ where: { kind: RepoKind.CODE } })) {
    if (r.kbRequest) continue; // a request held back (no model yet, delete behind a running scan) waits as before
    if (!modelReady || !kbSelected(kbCfg, r) || r.status !== RepoStatus.INDEXED || !r.headCommit || r.kbScannedCommit === r.headCommit) continue;
    const last = await prisma.knowledgeScan.findFirst({ where: { repoId: r.id }, orderBy: { startedAt: "desc" } });
    if (last?.status === ScanStatus.RUNNING) continue;
    if (last && now - last.startedAt.getTime() < kbCfg.refreshIntervalHours * 3_600_000) continue;
    await kbQueue.add("scan", { repoId: r.id, manual: false }, { jobId: `kb-${r.id}-${r.headCommit}` });
  }
}

let configTimer: NodeJS.Timeout | undefined;
/** A changed config.json triggers a resync, debounced: editors write in several steps. */
function watchConfig() {
  if (/^https?:\/\//.test(env.configPath)) return;
  try {
    fs.watch(env.configPath, () => {
      clearTimeout(configTimer);
      configTimer = setTimeout(() => syncAllConnections().catch((e) => console.error("config resync failed:", e)), 1000);
    });
  } catch (e) {
    console.warn(`not watching ${env.configPath}: ${e}`);
  }
}

syncAllConnections()
  .catch((e) => console.error("initial sync failed:", e))
  .finally(() => {
    watchConfig();
    claimRequests(); // requests written while the worker was down
    setInterval(() => scheduleTick().catch((e) => console.error("schedule tick failed:", e)), 30_000);
  });
// a scan interrupted by a crash or restart never finishes; close it out so the scheduler can retry
prisma.knowledgeScan
  .updateMany({ where: { status: ScanStatus.RUNNING }, data: { status: ScanStatus.FAILED, error: "interrupted by restart", finishedAt: new Date() } })
  .catch((e) => console.error("scan cleanup failed:", e));
setInterval(() => discussionTick().catch((e) => console.error("discussion tick failed:", e)), 30_000);
setInterval(() => kbTick().catch((e) => console.error("kb tick failed:", e)), 30_000);
announceJobs([connWorker, worker, discussionWorker, syncWorker, kbWorker], signals);
signals.onRequest(claimRequests);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await worker.close();
    await connWorker.close();
    await connQueue.close();
    await kbWorker.close();
    await discussionWorker.close();
    await discussionQueue.close();
    await syncWorker.close();
    await syncQueue.close();
    await indexQueue.close();
    await kbQueue.close();
    signals.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

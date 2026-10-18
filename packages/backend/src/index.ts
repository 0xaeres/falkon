import fs from "node:fs";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@sbc/db";
import { env, loadConfig, repoGitDir } from "@sbc/shared";
import { resolveConnections } from "./connections";
import { syncRepo } from "./git";
import { indexRepo, removeShards } from "./zoekt";

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
    const indexBranches = ["HEAD", ...s.branches];
    const repo = await prisma.repo.upsert({
      where: { name: s.name },
      create: { name: s.name, cloneUrl: s.cloneUrl, tokenEnv: s.tokenEnv, indexBranches },
      update: { cloneUrl: s.cloneUrl, tokenEnv: s.tokenEnv, indexBranches },
    });
    // jobId dedupes: a repo already queued is not queued twice
    await queue.add("sync", { repoId: repo.id }, { jobId: `sync-${repo.id}-${Math.floor(Date.now() / 60_000)}` });
  }

  for (const r of await prisma.repo.findMany({ where: { name: { notIn: [...names] } } })) {
    removeShards(r.name);
    fs.rmSync(repoGitDir(r.name), { recursive: true, force: true });
    await prisma.repo.delete({ where: { id: r.id } });
    console.log(`removed ${r.name}`);
  }
  return cfg.resyncIntervalMinutes;
}

const worker = new Worker<{ repoId: number }>(
  QUEUE,
  async (job) => {
    const repo = await prisma.repo.findUniqueOrThrow({ where: { id: job.data.repoId } });
    await prisma.repo.update({ where: { id: repo.id }, data: { status: "SYNCING", error: null } });
    try {
      const token = repo.tokenEnv ? process.env[repo.tokenEnv] : undefined;
      const dir = repoGitDir(repo.name);
      const meta = await syncRepo(dir, repo.cloneUrl, token);
      const wanted = repo.indexBranches.filter((b) => b === "HEAD" || meta.branches.includes(b));
      await indexRepo(repo.name, dir, wanted);
      await prisma.repo.update({
        where: { id: repo.id },
        data: {
          status: "INDEXED",
          defaultBranch: meta.defaultBranch,
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

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

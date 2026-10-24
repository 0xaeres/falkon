/**
 * Which repositories the live pull request sync runs for, and the job that runs one (D116, D118, D123). The plan is a pure
 * function of the stored rows and the clock so the scheduler is testable without Redis or Postgres.
 */
import { importDiscussions, type ImportTarget } from "./discussions";
import type { DiscussionSource, GithubConnectionConfig, ProvenanceStore, SyncState } from "@falkon/shared";

const HOUR = 3_600_000;
/** Most jobs one tick enqueues: a Product does not burst, the rest wait for the next tick (oldest run first). */
export const MAX_JOBS_PER_TICK = 20;
/** A `running` state younger than this is a live run; older is a crash leftover and the repository is due again. */
const STALE_RUNNING_MS = 2 * HOUR;
const isRunning = (s: Pick<SyncState, "status" | "lastRunAt"> | undefined, t: number) => s?.status === "running" && !!s.lastRunAt && t - s.lastRunAt.getTime() < STALE_RUNNING_MS;

export interface PlanRepo {
  id: number;
  indexed: boolean;
  headCommit: string | null;
  connections: { config: unknown }[];
  state?: Pick<SyncState, "status" | "lastRunAt" | "waitUntil" | "access" | "reconciledAt">;
}

export interface SyncJob {
  repoId: number;
  reconcile: boolean;
  jobId: string;
}

/** The first GitHub connection with `discussions: true` and a token; its token reads this repository's pull requests. */
export function discussionConnection(connections: { config: unknown }[]): GithubConnectionConfig | undefined {
  return connections.map((c) => c.config as GithubConnectionConfig).find((c) => c?.type === "github" && c.discussions === true && c.token);
}

/** Repositories to enqueue now, at most `limit`, never-run first and then the oldest run. A snapshot directory suppresses all. */
export function planDiscussionSync(
  repos: PlanRepo[],
  { now, intervalMs, reconcileMs, snapshot, limit = MAX_JOBS_PER_TICK }: { now: Date; intervalMs: number; reconcileMs: number; snapshot: boolean; limit?: number },
): SyncJob[] {
  if (snapshot) return [];
  const t = now.getTime();
  const bucket = Math.floor(t / intervalMs);
  return repos
    .filter((r) => {
      if (!r.indexed || !r.headCommit || !discussionConnection(r.connections)) return false;
      const s = r.state;
      if (s?.waitUntil && s.waitUntil.getTime() > t) return false;
      if (isRunning(s, t)) return false;
      // a repository the token cannot read is probed at most once an hour
      const gap = s?.access === "no-access" ? Math.max(intervalMs, HOUR) : intervalMs;
      return !s?.lastRunAt || s.lastRunAt.getTime() <= t - gap;
    })
    .sort((a, b) => (a.state?.lastRunAt?.getTime() ?? 0) - (b.state?.lastRunAt?.getTime() ?? 0) || a.id - b.id)
    .slice(0, limit)
    .map((r) => ({ repoId: r.id, reconcile: !r.state?.reconciledAt || r.state.reconciledAt.getTime() <= t - reconcileMs, jobId: `discussion-sync-${r.id}-${bucket}` }));
}

/**
 * One repository's run. `conn` is the connection as the job starts: undefined (the flag was turned off, the token dropped) ends
 * the job quietly. A run that yielded to the rate limit is requeued delayed to the reset time, under a distinct job id.
 */
export async function runDiscussionJob(o: {
  store: ProvenanceStore;
  target: ImportTarget;
  conn: GithubConnectionConfig | undefined;
  reconcile: boolean;
  makeSource: (conn: GithubConnectionConfig, reconcile: boolean) => Promise<DiscussionSource>;
  requeue: (data: { repoId: number; reconcile: boolean }, jobId: string, delayMs: number) => Promise<void>;
  ticketKeys: string[];
  now?: () => Date;
}) {
  if (!o.conn) return;
  const now = o.now ?? (() => new Date());
  const id = o.target.id;
  const before = await o.store.syncState(id);
  // a run that started less than 2 hours ago still owns the repository (a tick job and a delayed job can meet here)
  if (isRunning(before, now().getTime())) return;
  /** A run that ends without importDiscussions saving a state still moves the repository to the back of the queue. */
  const stamp = async (error: string) => {
    const s = (await o.store.syncState(id)) ?? { cursorUpdatedAt: null, lastRunAt: null, lastSuccessAt: null, headCommit: null, status: "failed" as const, error, importedCount: 0, skippedCount: 0, access: "unknown" as const, waitUntil: null, reconciledAt: null };
    await o.store.saveSyncState(id, { ...s, status: "failed", error, lastRunAt: now(), waitUntil: null });
  };
  const started = now();
  let r;
  try {
    r = await importDiscussions(o.store, await o.makeSource(o.conn, o.reconcile), o.target, o.ticketKeys, now);
  } catch (e) {
    // importDiscussions stamps its own failures; anything earlier (token, transport, covers) is stamped here with fixed text
    const s = await o.store.syncState(id);
    if (!s?.lastRunAt || s.lastRunAt < started || s.status === "running") await stamp("sync failed").catch(() => {});
    throw e;
  }
  if (!r) {
    await stamp("not covered");
    return r;
  }
  const s = await o.store.syncState(id);
  if (s?.status === "waiting" && s.waitUntil) {
    await o.requeue({ repoId: id, reconcile: o.reconcile }, `discussion-sync-${id}-wait-${s.waitUntil.getTime()}`, Math.max(0, s.waitUntil.getTime() - now().getTime()));
  } else if (o.reconcile && s?.status === "ok" && s.access === "ok") {
    await o.store.saveSyncState(id, { ...s, reconciledAt: now() });
  }
  return r;
}

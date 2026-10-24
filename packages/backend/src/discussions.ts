/**
 * Pull request import (ADR 0001, 4.11): a DiscussionSource (the recorded snapshot now, the live GitHub API next cycle) into
 * the ProvenanceStore, one transaction per pull request, then the commit links of the repository checked against its clone.
 */
import fs from "node:fs";
import path from "node:path";
import { NoAccess, RateLimited, discussionLinks, type Discussion, type DiscussionComment, type DiscussionSource, type Link, type ProvenanceStore } from "@falkon/shared";
import { git } from "./git";

// ---- snapshot source -------------------------------------------------------------------------------------------

// Third-party text must not break the database: Postgres text and jsonb refuse NUL, jsonb refuses lone surrogates.
const clean = (s: string) => s.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
const date = (v: unknown) => {
  const d = typeof v === "string" && v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const need = (v: unknown) => {
  const d = date(v);
  if (!d) throw new Error("snapshot file has an invalid date");
  return d;
};
const text = (v: unknown) => (typeof v === "string" ? clean(v) : "");
const login = (v: unknown) => (typeof v === "string" ? clean(v) : null);
/** An int4 integer, else null. */
const int = (v: unknown) => (Number.isInteger(v) && Math.abs(v as number) <= 2_147_483_647 ? (v as number) : null);
const count = (v: unknown) => Math.max(0, int(v) ?? 0);

/** One pull request file as S47 records it (tests/eval/discussions.ts `shape`), mapped to the source-neutral shape. */
export function mapSnapshotPull(p: any): Discussion {
  const number = int(p?.number);
  if (number === null || number < 1) throw new Error("snapshot file has no pull request number");
  const comment = (kind: DiscussionComment["kind"], c: any, at: unknown, updated: unknown): DiscussionComment => ({
    externalId: String(c.id), kind, authorLogin: login(c.authorLogin), body: text(c.body), state: kind === "review" ? login(c.state) : null,
    path: kind === "review_comment" ? login(c.path) : null, line: int(c.line), createdAt: need(at), updatedAt: date(updated),
  });
  return {
    kind: "PR", number, title: text(p.title), body: text(p.body), state: p.merged ? "merged" : p.state === "open" ? "open" : "closed",
    authorLogin: login(p.authorLogin), createdAt: need(p.createdAt), updatedAt: need(p.updatedAt), mergedAt: date(p.mergedAt), closedAt: date(p.closedAt),
    mergeCommitSha: typeof p.mergeCommitSha === "string" && /^[0-9a-f]{40}$/.test(p.mergeCommitSha) ? p.mergeCommitSha : null,
    headRef: login(p.headRef), baseRef: login(p.baseRef), url: login(p.url), labels: (p.labels ?? []).filter((l: unknown) => typeof l === "string").map(clean),
    truncated: Object.keys(p.truncated ?? {}).filter((k) => p.truncated[k] === true).sort(),
    comments: [
      ...(p.comments ?? []).map((c: any) => comment("issue_comment", c, c.createdAt, c.updatedAt)),
      ...(p.reviews ?? []).map((c: any) => comment("review", c, c.submittedAt ?? p.createdAt, null)),
      ...(p.reviewComments ?? []).map((c: any) => comment("review_comment", c, c.createdAt, c.updatedAt)),
    ],
    files: (p.files ?? []).filter((f: any) => typeof f?.path === "string").map((f: any) => ({ path: clean(f.path), additions: count(f.additions), deletions: count(f.deletions) })),
  };
}

/**
 * `<dir>/<name>/_meta.json` and `<dir>/<name>/pulls/<number>.json`, where `<name>` is the last segment of the repository
 * name and `_meta.json` names the same owner as the segment before it. Files are read one at a time.
 */
export function snapshotSource(dir: string): DiscussionSource {
  const where = (repo: string) => {
    const [owner, name] = repo.split("/").slice(-2);
    if (!owner || !name || !/^[\w.-]+$/.test(name) || /^\.+$/.test(name)) return undefined;
    const root = path.join(dir, name);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root, "_meta.json"), "utf8"));
      return meta.repo === name && String(meta.owner).toLowerCase() === owner.toLowerCase() ? path.join(root, "pulls") : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    covers: async (repo) => where(repo) !== undefined && fs.existsSync(where(repo)!),
    async *pulls(repo, since) {
      const pulls = where(repo);
      if (!pulls) return;
      const files = fs.readdirSync(pulls).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      for (const f of files) {
        let d: Discussion;
        try {
          d = mapSnapshotPull(JSON.parse(fs.readFileSync(path.join(pulls, f), "utf8")));
        } catch {
          yield { skipped: f }; // one malformed file must not stop the repository's import
          continue;
        }
        if (!since || d.updatedAt >= since) yield d;
      }
    },
  };
}

// ---- commit linker -------------------------------------------------------------------------------------------------

/**
 * Commit → pull request links, first match wins: (1) a pull request's merge commit sha; (2) a subject ending `(#N)` (squash);
 * (3) a `Merge pull request #N from` subject. Rules 2 and 3 only name pull requests the store holds. Every commit the log of
 * `head` lists is in the clone and reachable from head, so rules 2 and 3 are verified by construction; a rule 1 sha that the
 * log does not list (force-pushed away, or on no branch of head) is stored unverified. Head-branch shas are never stored.
 */
export async function commitLinks(dir: string, head: string, prs: { number: number; mergeCommitSha: string | null }[]): Promise<Link[]> {
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("head is not a commit sha");
  // ponytail: one in-memory log of head's history (about 100 bytes a commit); stream it if a repository nears 500k commits.
  const log = (await git(dir, ["log", "--format=%H%x09%s", head, "--"])).split("\n").filter(Boolean).map((l) => [l.slice(0, 40), l.slice(41)] as const);
  const reachable = new Set(log.map(([sha]) => sha));
  const numbers = new Set(prs.map((p) => p.number));
  const links: Link[] = [];
  const link = (sha: string, n: number, source: Link["source"], verified: boolean) =>
    links.push({ fromKind: "commit", fromRef: sha, toKind: "pr", toRef: String(n), toRepo: null, source, verified });
  const merged = new Set<string>();
  for (const p of prs) {
    if (!p.mergeCommitSha) continue;
    merged.add(p.mergeCommitSha); // two pull requests recording one merge commit both get it
    link(p.mergeCommitSha, p.number, "merge-commit-sha", reachable.has(p.mergeCommitSha));
  }
  for (const [sha, subject] of log) {
    if (merged.has(sha)) continue;
    const squash = /\(#(\d+)\)\s*$/.exec(subject), merge = /^Merge pull request #(\d+) from /.exec(subject);
    if (squash && numbers.has(Number(squash[1]))) link(sha, Number(squash[1]), "squash-subject", true);
    else if (merge && numbers.has(Number(merge[1]))) link(sha, Number(merge[1]), "merge-subject", true);
  }
  return links;
}

// ---- import --------------------------------------------------------------------------------------------------------

export const MAX_TEXT = 64 * 1024;

/** At most `n` UTF-16 units, never ending inside a surrogate pair. */
const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1]!) ? n - 1 : n));

/** Bodies over MAX_TEXT characters are cut and flagged (`body`, `commentBodies`). */
function capped(d: Discussion): Discussion {
  const truncated = new Set(d.truncated);
  if (d.body.length > MAX_TEXT) truncated.add("body");
  if (d.comments.some((c) => c.body.length > MAX_TEXT)) truncated.add("commentBodies");
  return { ...d, body: cut(d.body, MAX_TEXT), comments: d.comments.map((c) => ({ ...c, body: cut(c.body, MAX_TEXT) })), truncated: [...truncated].sort() };
}

export interface ImportTarget {
  id: number;
  name: string;
  /** The clone (work tree or bare) and the indexed default-branch head the commit links are verified against. */
  dir: string;
  head: string | null;
}

/**
 * Imports the pull requests updated since the last successful run (re-importing is idempotent), then recomputes the
 * repository's commit links. Undefined when the source has nothing for the repository: it stays a coverage gap.
 */
export async function importDiscussions(store: ProvenanceStore, source: DiscussionSource, repo: ImportTarget, ticketKeys: string[], now = () => new Date()) {
  const state = (await store.syncState(repo.id)) ?? { cursorUpdatedAt: null, lastRunAt: null, lastSuccessAt: null, headCommit: null, status: "running" as const, error: null, importedCount: 0, skippedCount: 0, access: "unknown" as const, waitUntil: null, reconciledAt: null };
  const started = now();
  /** A source signal is no failure: save how far the run got (never moving the cursor past an unprocessed or skipped item) and stop. */
  const halt = async (e: RateLimited | NoAccess, cursor: Date | null, imported: number, skipped: number) => {
    // links were not recomputed, so the next run must (headCommit null); lastSuccessAt stays, a run that never finished is no success
    const next = { ...state, cursorUpdatedAt: cursor, lastRunAt: started, error: null, skippedCount: skipped, headCommit: imported ? null : state.headCommit };
    await store.saveSyncState(repo.id, e instanceof NoAccess ? { ...next, status: "ok", access: "no-access", waitUntil: null } : { ...next, status: "waiting", waitUntil: e.resetAt });
    return { imported, skipped, total: state.importedCount, commitLinks: undefined, ms: now().getTime() - started.getTime() };
  };
  try {
    if (!(await source.covers(repo.name))) return undefined;
  } catch (e) {
    if (e instanceof RateLimited || e instanceof NoAccess) return halt(e, state.cursorUpdatedAt, 0, state.skippedCount);
    throw e;
  }
  await store.saveSyncState(repo.id, { ...state, status: "running", lastRunAt: started, waitUntil: null });
  let imported = 0, skipped = 0, cursor = state.cursorUpdatedAt, held = cursor;
  try {
    if (!repo.head) throw new Error("repository not indexed");
    for await (const pull of source.pulls(repo.name, state.cursorUpdatedAt)) {
      if ("skipped" in pull) {
        if (!skipped++) held = cursor; // a signal later in the run must not park the cursor past this item
        continue;
      }
      const d = capped(pull);
      await store.replaceDiscussion(repo.id, d, discussionLinks(d, repo.name, ticketKeys));
      imported++;
      if (!cursor || d.updatedAt > cursor) cursor = d.updatedAt;
    }
    const prs = await store.mergeCommits(repo.id);
    let commitLinkCount: number | undefined;
    if (imported || state.headCommit !== repo.head || !state.lastSuccessAt) {
      const links = await commitLinks(repo.dir, repo.head, prs);
      await store.replaceCommitLinks(repo.id, links);
      commitLinkCount = links.length;
    }
    const done = now();
    // With a skipped file the cursor stays put, so the next run reads it again (and counts it again) until it is fixed.
    await store.saveSyncState(repo.id, { ...state, cursorUpdatedAt: skipped ? state.cursorUpdatedAt : cursor, lastRunAt: started, lastSuccessAt: done, headCommit: repo.head, status: "ok", error: null, importedCount: prs.length, skippedCount: skipped, access: "ok", waitUntil: null });
    return { imported, skipped, total: prs.length, commitLinks: commitLinkCount, ms: done.getTime() - started.getTime() };
  } catch (e) {
    if (e instanceof RateLimited || e instanceof NoAccess) return halt(e, skipped ? held : cursor, imported, skipped);
    // a fixed string: provider text never reaches the state row
    await store.saveSyncState(repo.id, { ...state, lastRunAt: started, status: "failed", error: "import failed", waitUntil: null }).catch(() => {});
    throw e;
  }
}

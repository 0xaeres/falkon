/**
 * Pull request provenance (ADR 0001, 4.11 and P12): the `DiscussionSource` and `ProvenanceStore` ports, the text links of a
 * pull request (ticket keys, `#N` references) and the Postgres adapter. Pull request text is untrusted third-party content.
 * Every read takes the caller's effective repository set: a repository outside it behaves like a missing one, a link whose
 * other end lies outside it is dropped, and a repository in it that was never imported is reported as a coverage gap.
 */

export type CommentKind = "issue_comment" | "review" | "review_comment";

export interface DiscussionComment {
  /** The provider's id of the comment or review. */
  externalId: string;
  kind: CommentKind;
  authorLogin: string | null;
  body: string;
  /** A review's verdict (APPROVED, CHANGES_REQUESTED, COMMENTED, ...); null for comments. */
  state: string | null;
  path: string | null;
  line: number | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface DiscussionFile {
  path: string;
  additions: number;
  deletions: number;
}

/** A pull request (later an issue) as every source maps it. Logins only, never emails (D114). */
export interface Discussion {
  kind: "PR" | "ISSUE";
  number: number;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  authorLogin: string | null;
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  mergeCommitSha: string | null;
  headRef: string | null;
  baseRef: string | null;
  url: string | null;
  labels: string[];
  /** Parts cut short: by the source (comments, reviews, reviewComments, files) or on import (body, commentBodies). */
  truncated: string[];
  comments: DiscussionComment[];
  files: DiscussionFile[];
}

export type LinkSource = "merge-commit-sha" | "squash-subject" | "merge-subject" | "body-ref" | "ticket-pattern";

/** commit → pr (the commit-subject and merge-commit rules), pr → ticket, pr → pr (body references). */
export interface Link {
  fromKind: "commit" | "pr";
  fromRef: string;
  toKind: "pr" | "ticket";
  toRef: string;
  /** The repository of a `pr` target in another repository; null for the link's own repository and for tickets. */
  toRepo: string | null;
  source: LinkSource;
  /** A commit link whose commit is in the local clone and reachable from the indexed head. Unverified links are hidden by default. */
  verified: boolean;
}

export interface RepoLink extends Link {
  repo: string;
}

export interface SyncState {
  cursorUpdatedAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  /** The head the commit links were last computed against. */
  headCommit: string | null;
  /** `waiting`: the source yielded to a rate limit; see `waitUntil`. */
  status: "running" | "ok" | "failed" | "waiting";
  /** Whether the token may read the repository's pull requests; `unknown` until the first probe (D115). */
  access: "unknown" | "ok" | "no-access";
  /** When `waiting`: the provider's reset time, before which no run should start. */
  waitUntil: Date | null;
  /** The last full reconcile (D116). */
  reconciledAt: Date | null;
  /** A fixed string, never provider text. */
  error: string | null;
  importedCount: number;
  /** Source items the last run could not read (malformed); the cursor does not move past them. */
  skippedCount: number;
}

/** A source throws this from `covers` or `pulls` when the provider's budget is nearly spent; the import saves its progress and waits. */
export class RateLimited extends Error {
  constructor(readonly resetAt: Date) {
    super("rate limited");
  }
}

/** A source throws this from `covers` or `pulls` when the token may not read the repository's pull requests. */
export class NoAccess extends Error {
  constructor() {
    super("no access");
  }
}

/** Where discussions come from: a recorded snapshot now, the live GitHub API later (D107). Same mapper output for both. */
export interface DiscussionSource {
  /** Whether the source holds data for this repository at all. */
  covers(repo: string): Promise<boolean>;
  /** Pull requests updated at or after `since` (all when null), one at a time; `skipped` names an item that could not be read. */
  pulls(repo: string, since: Date | null): AsyncIterable<Discussion | { skipped: string }>;
}

export type Anchor = { kind: "commit"; sha: string } | { kind: "pr"; repo: string; number: number } | { kind: "ticket"; key: string };

export interface SearchQuery {
  words: string[];
  repo?: string;
  limit?: number;
  offset?: number;
  kind?: Discussion["kind"];
  state?: Discussion["state"];
  /** Created at or after / at or before. */
  since?: Date;
  until?: Date;
}

export interface SearchHit {
  repo: string;
  number: number;
  title: string;
  state: string;
  mergedAt: Date | null;
  updatedAt: Date;
  url: string | null;
}

export interface SearchResult {
  hits: SearchHit[];
  hasMore: boolean;
  gaps: string[];
  timedOut: boolean;
  /** Every match, at most MAX_OFFSET (`totalCapped` says it stopped there). */
  total: number;
  totalCapped: boolean;
}

/** Provenance storage (D87, D106): Postgres now, the graph database later. */
export interface ProvenanceStore {
  // import side, by repository id
  syncState(repoId: number): Promise<SyncState | undefined>;
  saveSyncState(repoId: number, state: SyncState): Promise<void>;
  /** Upserts one discussion and replaces its comments, files and outgoing links as a set, in one transaction. */
  replaceDiscussion(repoId: number, d: Discussion, links: Link[]): Promise<void>;
  mergeCommits(repoId: number): Promise<{ number: number; mergeCommitSha: string | null }[]>;
  /** Replaces every commit link of the repository as a set. */
  replaceCommitLinks(repoId: number, links: Link[]): Promise<void>;
  // read side, by the caller's effective repository set (P12)
  getDiscussion(repos: string[], repo: string, number: number): Promise<Discussion | { gap: string } | undefined>;
  search(repos: string[], q: SearchQuery): Promise<SearchResult>;
  links(repos: string[], anchor: Anchor, o?: { unverified?: boolean }): Promise<{ links: RepoLink[]; gaps: string[] }>;
}

export const notIngested = (repo: string) => `pull requests not ingested for ${repo}`;

/** Read bounds shared by every adapter. */
// MAX_ROWS caps comments, files and links per read silently: S49 must report a `truncated` flag when a cap is reached.
export const MAX_ROWS = 500, MAX_HITS = 20, MAX_WORDS = 8, MAX_WORD = 100, MAX_OFFSET = 1000, SEARCH_TIMEOUT_MS = 2000;

/** Clamped search input: at most MAX_WORDS non-empty words of at most MAX_WORD characters, 1 to MAX_HITS hits per page. */
export function searchBounds(q: SearchQuery) {
  const words = q.words.map((w) => w.trim().slice(0, MAX_WORD)).filter(Boolean).slice(0, MAX_WORDS);
  const finite = (v: number | undefined, d: number) => (Number.isFinite(v) ? Math.floor(v!) : d);
  const limit = Math.min(MAX_HITS, Math.max(1, finite(q.limit, MAX_HITS)));
  const offset = Math.min(MAX_OFFSET, Math.max(0, finite(q.offset, 0)));
  return { words, limit, offset };
}

/** A word as a literal ILIKE substring pattern (backslash is Postgres's default LIKE escape). */
export const likePattern = (word: string) => `%${word.replace(/[\\%_]/g, "\\$&")}%`;

const KEY = /^[A-Z][A-Z0-9_]*$/;

/** Operator-configured Jira project keys (D112), e.g. DISCUSSION_TICKET_KEYS=TRUNK,RESTWS,O3. Invalid entries are dropped. */
export const parseTicketKeys = (value: string | undefined) => (value ?? "").split(",").map((k) => k.trim().toUpperCase()).filter((k) => KEY.test(k));

/** Ticket keys of the configured projects (any case, e.g. in branch names) plus any key in a Jira browse link; no generic pattern. */
export function ticketKeys(text: string, keys: string[]): string[] {
  const found = new Set<string>();
  const safe = keys.filter((k) => KEY.test(k));
  if (safe.length) for (const m of text.matchAll(new RegExp(`(?<![A-Za-z0-9])(${safe.join("|")})-(\\d+)(?![A-Za-z0-9])`, "gi"))) found.add(`${m[1]!.toUpperCase()}-${m[2]}`);
  for (const m of text.matchAll(/https?:\/\/[^\s/]+\/browse\/([A-Z][A-Z0-9_]*-\d+)(?![0-9])/g)) found.add(m[1]!);
  return [...found];
}

/**
 * The links a pull request's own text makes: ticket keys from its title, body and head branch name, and `#N` or `owner/repo#N`
 * references in its body. A reference to another repository is named `<host>/<owner>/<repo>` after this repository's host.
 */
export function discussionLinks(d: Pick<Discussion, "number" | "title" | "body" | "headRef">, repoName: string, keys: string[]): Link[] {
  const from = { fromKind: "pr" as const, fromRef: String(d.number), verified: true };
  const links = new Map<string, Link>();
  const add = (l: Link) => links.set(`${l.toKind} ${l.toRepo ?? ""} ${l.toRef}`, l);
  for (const key of ticketKeys([d.title, d.body, d.headRef ?? ""].join("\n"), keys)) add({ ...from, toKind: "ticket", toRef: key, toRepo: null, source: "ticket-pattern" });
  const host = repoName.split("/")[0]!;
  for (const m of d.body.matchAll(/(?<![\w./-])([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)#(\d+)\b/g)) {
    const target = `${host}/${m[1]}/${m[2]}`;
    const toRepo = target.toLowerCase() === repoName.toLowerCase() ? null : target;
    if (toRepo || Number(m[3]) !== d.number) add({ ...from, toKind: "pr", toRef: String(Number(m[3])), toRepo, source: "body-ref" });
  }
  for (const m of d.body.matchAll(/(?<![\w/&#.-])#(\d+)\b/g)) {
    if (Number(m[1]) !== d.number) add({ ...from, toKind: "pr", toRef: String(Number(m[1])), toRepo: null, source: "body-ref" });
  }
  return [...links.values()];
}

// ---- Postgres adapter ---------------------------------------------------------------------------------------------

/** The part of a Prisma client the adapter uses (raw SQL only), so this package needs no database dependency. */
export interface Sql {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}
export interface SqlClient extends Sql {
  $transaction<R>(fn: (tx: Sql) => Promise<R>, options?: { timeout?: number }): Promise<R>;
}

// Timestamps travel as ISO strings and are cast to Prisma's `timestamp(3)` (UTC; the zone suffix is ignored by the cast).
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const TS = "timestamp(3)";

type RepoRow = { id: number; name: string; ingested: boolean };

export function postgresProvenanceStore(db: SqlClient): ProvenanceStore {
  /** Code repositories among `names` with whether a pull request import ever succeeded for them. */
  const repoRows = (names: string[]) =>
    names.length
      ? db.$queryRawUnsafe<RepoRow[]>(
          `SELECT r.id, r.name, (s."lastSuccessAt" IS NOT NULL) AS ingested FROM "Repo" r LEFT JOIN "DiscussionSyncState" s ON s."repoId" = r.id
           WHERE r.name = ANY($1::text[]) AND r.kind = 'CODE' ORDER BY r.name`,
          names,
        )
      : Promise.resolve([] as RepoRow[]);
  const gapsOf = (rows: RepoRow[]) => rows.filter((r) => !r.ingested).map((r) => notIngested(r.name));

  // Row sets travel as one JSON parameter (Dates become ISO strings): no per-column array typing of nulls.
  const insertLinks = (tx: Sql, repoId: number, links: Link[]) =>
    links.length
      ? tx.$executeRawUnsafe(
          `INSERT INTO "ProvenanceLink" ("repoId", "fromKind", "fromRef", "toKind", "toRef", "toRepo", "source", "verified")
           SELECT $1, * FROM jsonb_to_recordset($2::jsonb) AS x("fromKind" text, "fromRef" text, "toKind" text, "toRef" text, "toRepo" text, source text, verified boolean)`,
          repoId, JSON.stringify(links),
        )
      : Promise.resolve(0);

  return {
    async syncState(repoId) {
      const [s] = await db.$queryRawUnsafe<SyncState[]>(
        `SELECT "cursorUpdatedAt", "lastRunAt", "lastSuccessAt", "headCommit", status, error, "importedCount", "skippedCount", access, "waitUntil", "reconciledAt" FROM "DiscussionSyncState" WHERE "repoId" = $1`,
        repoId,
      );
      return s;
    },

    async saveSyncState(repoId, s) {
      await db.$executeRawUnsafe(
        `INSERT INTO "DiscussionSyncState" ("repoId", "cursorUpdatedAt", "lastRunAt", "lastSuccessAt", "headCommit", status, error, "importedCount", "skippedCount", access, "waitUntil", "reconciledAt")
         VALUES ($1, $2::${TS}, $3::${TS}, $4::${TS}, $5, $6, $7, $8, $9, $10, $11::${TS}, $12::${TS})
         ON CONFLICT ("repoId") DO UPDATE SET "cursorUpdatedAt" = EXCLUDED."cursorUpdatedAt", "lastRunAt" = EXCLUDED."lastRunAt",
           "lastSuccessAt" = EXCLUDED."lastSuccessAt", "headCommit" = EXCLUDED."headCommit", status = EXCLUDED.status, error = EXCLUDED.error,
           "importedCount" = EXCLUDED."importedCount", "skippedCount" = EXCLUDED."skippedCount",
           access = EXCLUDED.access, "waitUntil" = EXCLUDED."waitUntil", "reconciledAt" = EXCLUDED."reconciledAt"`,
        repoId, iso(s.cursorUpdatedAt), iso(s.lastRunAt), iso(s.lastSuccessAt), s.headCommit, s.status, s.error, s.importedCount, s.skippedCount,
        s.access, iso(s.waitUntil), iso(s.reconciledAt),
      );
    },

    async replaceDiscussion(repoId, d, links) {
      await db.$transaction(async (tx) => {
        const [{ id }] = await tx.$queryRawUnsafe<[{ id: number }]>(
          `INSERT INTO "Discussion" ("repoId", number, kind, title, body, state, "authorLogin", "createdAt", "updatedAt", "mergedAt", "closedAt",
             "mergeCommitSha", "headRef", "baseRef", url, labels, truncated)
           VALUES ($1, $2, $3::"DiscussionKind", $4, $5, $6, $7, $8::${TS}, $9::${TS}, $10::${TS}, $11::${TS}, $12, $13, $14, $15, $16::text[], $17::text[])
           ON CONFLICT ("repoId", number) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, body = EXCLUDED.body, state = EXCLUDED.state,
             "authorLogin" = EXCLUDED."authorLogin", "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt", "mergedAt" = EXCLUDED."mergedAt",
             "closedAt" = EXCLUDED."closedAt", "mergeCommitSha" = EXCLUDED."mergeCommitSha", "headRef" = EXCLUDED."headRef", "baseRef" = EXCLUDED."baseRef",
             url = EXCLUDED.url, labels = EXCLUDED.labels, truncated = EXCLUDED.truncated
           RETURNING id`,
          repoId, d.number, d.kind, d.title, d.body, d.state, d.authorLogin, iso(d.createdAt), iso(d.updatedAt), iso(d.mergedAt), iso(d.closedAt),
          d.mergeCommitSha, d.headRef, d.baseRef, d.url, d.labels, d.truncated,
        );
        await tx.$executeRawUnsafe(`DELETE FROM "DiscussionComment" WHERE "discussionId" = $1`, id);
        await tx.$executeRawUnsafe(`DELETE FROM "DiscussionFile" WHERE "discussionId" = $1`, id);
        await tx.$executeRawUnsafe(`DELETE FROM "ProvenanceLink" WHERE "repoId" = $1 AND "fromKind" = 'pr' AND "fromRef" = $2`, repoId, String(d.number));
        if (d.comments.length)
          await tx.$executeRawUnsafe(
            `INSERT INTO "DiscussionComment" ("discussionId", "externalId", kind, "authorLogin", body, state, path, line, "createdAt", "updatedAt")
             SELECT $1, * FROM jsonb_to_recordset($2::jsonb) AS x("externalId" text, kind text, "authorLogin" text, body text, state text, path text,
               line int, "createdAt" ${TS}, "updatedAt" ${TS})`,
            id, JSON.stringify(d.comments),
          );
        if (d.files.length)
          await tx.$executeRawUnsafe(
            `INSERT INTO "DiscussionFile" ("discussionId", path, additions, deletions) SELECT $1, * FROM jsonb_to_recordset($2::jsonb) AS x(path text, additions int, deletions int)`,
            id, JSON.stringify(d.files),
          );
        await insertLinks(tx, repoId, links);
      }, { timeout: 60_000 });
    },

    mergeCommits: (repoId) =>
      db.$queryRawUnsafe(`SELECT number, "mergeCommitSha" FROM "Discussion" WHERE "repoId" = $1 ORDER BY number`, repoId),

    async replaceCommitLinks(repoId, links) {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM "ProvenanceLink" WHERE "repoId" = $1 AND "fromKind" = 'commit'`, repoId);
        await insertLinks(tx, repoId, links);
      }, { timeout: 120_000 });
    },

    async getDiscussion(repos, repo, number) {
      if (!repos.includes(repo)) return undefined;
      const [r] = await repoRows([repo]);
      if (!r) return undefined;
      if (!r.ingested) return { gap: notIngested(repo) };
      const [d] = await db.$queryRawUnsafe<(Omit<Discussion, "comments" | "files"> & { id: number })[]>(
        `SELECT id, kind::text, number, title, body, state, "authorLogin", "createdAt", "updatedAt", "mergedAt", "closedAt", "mergeCommitSha",
           "headRef", "baseRef", url, labels, truncated FROM "Discussion" WHERE "repoId" = $1 AND number = $2`,
        r.id, number,
      );
      if (!d) return undefined;
      const { id, ...rest } = d;
      const comments = await db.$queryRawUnsafe<DiscussionComment[]>(
        `SELECT "externalId", kind, "authorLogin", body, state, path, line, "createdAt", "updatedAt" FROM "DiscussionComment"
         WHERE "discussionId" = $1 ORDER BY "createdAt", id LIMIT ${MAX_ROWS}`,
        id,
      );
      const files = await db.$queryRawUnsafe<DiscussionFile[]>(
        `SELECT path, additions, deletions FROM "DiscussionFile" WHERE "discussionId" = $1 ORDER BY path LIMIT ${MAX_ROWS}`,
        id,
      );
      return { ...rest, comments, files };
    },

    async search(repos, q) {
      const { words, limit, offset } = searchBounds(q);
      const names = q.repo === undefined ? repos : repos.filter((r) => r === q.repo);
      const rows = await repoRows(names);
      const ids = rows.filter((r) => r.ingested).map((r) => r.id);
      const gaps = gapsOf(rows);
      const none = { hits: [], hasMore: false, gaps, timedOut: false, total: 0, totalCapped: false };
      if (!words.length || !ids.length) return none;
      // Each word must appear (case-insensitively) in the title, body, head branch or any comment: words are ANDed.
      const where = words
        .map((_, i) => `(d.title ILIKE $${i + 2} OR d.body ILIKE $${i + 2} OR d."headRef" ILIKE $${i + 2}
          OR EXISTS (SELECT 1 FROM "DiscussionComment" c WHERE c."discussionId" = d.id AND c.body ILIKE $${i + 2}))`)
        .join(" AND ");
      // Optional filters take the parameters after the words'.
      const extra: { sql: string; value: unknown }[] = [
        ...(q.kind ? [{ sql: `d.kind = $N::"DiscussionKind"`, value: q.kind }] : []),
        ...(q.state ? [{ sql: `d.state = $N`, value: q.state }] : []),
        ...(q.since ? [{ sql: `d."createdAt" >= $N::${TS}`, value: iso(q.since) }] : []),
        ...(q.until ? [{ sql: `d."createdAt" <= $N::${TS}`, value: iso(q.until) }] : []),
      ];
      const filters = extra.map((e, i) => ` AND ${e.sql.replace("$N", `$${words.length + 2 + i}`)}`).join("");
      const params = [ids, ...words.map(likePattern), ...extra.map((e) => e.value)];
      try {
        const found = await db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${SEARCH_TIMEOUT_MS}`);
          const hits = await tx.$queryRawUnsafe<SearchHit[]>(
            `SELECT r.name AS repo, d.number, d.title, d.state, d."mergedAt", d."updatedAt", d.url FROM "Discussion" d JOIN "Repo" r ON r.id = d."repoId"
             WHERE d."repoId" = ANY($1::int[]) AND ${where}${filters} ORDER BY d."updatedAt" DESC, r.name, d.number LIMIT ${limit + 1} OFFSET ${offset}`,
            ...params,
          );
          const [{ n }] = await tx.$queryRawUnsafe<[{ n: number }]>(
            `SELECT count(*)::int AS n FROM (SELECT 1 FROM "Discussion" d WHERE d."repoId" = ANY($1::int[]) AND ${where}${filters} LIMIT ${MAX_OFFSET + 1}) x`,
            ...params,
          );
          return { hits, n };
        });
        return { hits: found.hits.slice(0, limit), hasMore: found.hits.length > limit, gaps, timedOut: false, total: Math.min(found.n, MAX_OFFSET), totalCapped: found.n > MAX_OFFSET };
      } catch (e) {
        // 57014: canceled by statement_timeout
        if (/57014|statement timeout/.test(String((e as { meta?: { code?: string } }).meta?.code ?? "") + String(e))) return { ...none, timedOut: true };
        throw e;
      }
    },

    async links(repos, anchor, o = {}) {
      if (anchor.kind === "pr" && !repos.includes(anchor.repo)) return { links: [], gaps: [] };
      const rows = await repoRows(anchor.kind === "pr" ? [anchor.repo] : repos);
      const ids = rows.filter((r) => r.ingested).map((r) => r.id);
      const gaps = gapsOf(rows);
      if (!ids.length) return { links: [], gaps };
      const match =
        anchor.kind === "commit" ? `l."fromKind" = 'commit' AND l."fromRef" = $4`
        : anchor.kind === "ticket" ? `l."toKind" = 'ticket' AND l."toRef" = $4`
        : `((r.name = $5 AND l."fromKind" = 'pr' AND l."fromRef" = $4) OR (l."toKind" = 'pr' AND l."toRef" = $4 AND COALESCE(l."toRepo", r.name) = $5))`;
      const ref = anchor.kind === "commit" ? anchor.sha.toLowerCase() : anchor.kind === "ticket" ? anchor.key.toUpperCase() : String(anchor.number);
      // The pr anchor also finds links that point at it from other repositories of the set.
      const scopeIds = anchor.kind === "pr" ? (await repoRows(repos)).filter((r) => r.ingested).map((r) => r.id) : ids;
      const links = await db.$queryRawUnsafe<RepoLink[]>(
        `SELECT r.name AS repo, l."fromKind", l."fromRef", l."toKind", l."toRef", l."toRepo", l.source, l.verified
         FROM "ProvenanceLink" l JOIN "Repo" r ON r.id = l."repoId"
         WHERE l."repoId" = ANY($1::int[]) AND (l."toRepo" IS NULL OR l."toRepo" = ANY($2::text[])) AND ($3::boolean OR l.verified) AND ${match}
         ORDER BY r.name, l."fromKind", l."fromRef", l."toKind", l."toRef" LIMIT ${MAX_ROWS}`,
        scopeIds, repos, o.unverified === true, ref, ...(anchor.kind === "pr" ? [anchor.repo] : []),
      );
      return { links, gaps };
    },
  };
}

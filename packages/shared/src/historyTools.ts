import { z } from "zod";
import { MAX_OFFSET, MAX_ROWS, MAX_WORD, MAX_WORDS, type Discussion, type ProvenanceStore, type RepoLink, notIngested } from "./provenance";
import { define, fileNotFound, git, isPathValid, repoOrThrow, type ToolContext } from "./tools";
import text from "./historyToolText.json" with { type: "json" };

/**
 * The pull request history tools (ADR 0001 4.11, D113): registered only with MCP_HISTORY_TOOLS=on, in their own registry so the
 * ten core tools and their contract snapshots stay untouched. They read Postgres through ToolDeps.history and, for a path, the
 * local clone; never the code host. Pull request text is untrusted third-party content.
 */

const t = text as Record<string, { description: string; params: Record<string, string> }>;
const p = (tool: string, param: string) => t[tool]!.params[param]!;

/** About 24 KB of JSON per answer. */
const MAX_BYTES = 24_000;
const BODY_CHARS = 8000, BODY_BYTES = 8000, COMMENT_CHARS = 2000, COMMENT_BYTES = 3000, TITLE_CHARS = 300;
const COMMENTS_PER_PAGE = 50, FILES = 100, PER_KIND = 50, SNIPPETS = 3, SNIPPET_CHARS = 300;
const GIT_TIMEOUT_MS = 15_000;
/** Candidates loaded for an exact ticket or #N lookup. */
const EXACT_LOADS = 200;

/** Largest pull request number: the store keeps it in an int4. */
const MAX_NUMBER = 2147483647;
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const jsonBytes = (s: string) => bytes(s) - 2;

/** `s` cut to at most `chars` characters and `maxBytes` bytes of JSON text, on a whole character. */
function clip(s: string, chars: number, maxBytes = Infinity) {
  let out = s.length > chars ? s.slice(0, chars) : s;
  if (jsonBytes(out) > maxBytes) {
    let lo = 0, hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (jsonBytes(out.slice(0, mid)) <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    out = out.slice(0, lo);
  }
  if (out.length < s.length) out = out.replace(/[\ud800-\udbff]$/, "");
  return { text: out, cut: out.length < s.length };
}

const history = (ctx: ToolContext): ProvenanceStore => {
  if (!ctx.deps.history) throw new Error("Pull request history is not available on this server.");
  return ctx.deps.history;
};

/** The caller's effective repository set (P12): the code repositories its scope allows. */
async function scopedNames(ctx: ToolContext) {
  return (await ctx.deps.listRepos({ sort: "name", direction: "asc" })).filter((r) => ctx.scope.allows(r.name)).map((r) => r.name);
}

/** Coverage gaps of `names` (one repository when given), without reading any discussion. */
const gapsOf = async (h: ProvenanceStore, names: string[], repo?: string) => (await h.search(names, { words: [], repo })).gaps;

const done = (v: unknown) => ({ output: JSON.stringify(v) });
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/, "Use an ISO 8601 date or time.").refine((s) => !Number.isNaN(Date.parse(s)), "Not a valid date.");

// ---- get_pull_request ----

const getPullRequest = define({
  name: "get_pull_request",
  description: t.get_pull_request!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().describe(p("get_pull_request", "repo")),
    number: z.number().int().positive().max(MAX_NUMBER).describe(p("get_pull_request", "number")),
    includeComments: z.boolean().describe(p("get_pull_request", "includeComments")).optional().default(true),
    offset: z.number().int().min(0).describe(p("get_pull_request", "offset")).optional().default(0),
  }).strict(),
  async execute({ repo, number, includeComments = true, offset = 0 }, ctx) {
    const r = await repoOrThrow(ctx, repo);
    const h = history(ctx);
    const names = await scopedNames(ctx);
    const d = await h.getDiscussion(names, repo, number);
    if (!d) throw new Error(`Pull request #${number} not found in "${repo}".`);
    if ("gap" in d) return done({ repo, number, coverageGaps: [d.gap] });

    const truncated = new Set<string>();
    for (const part of d.truncated) truncated.add(`${part} was cut when the pull request was imported`);
    const { links } = await h.links(names, { kind: "pr", repo, number });
    if (links.length >= MAX_ROWS) truncated.add(`links: the store returned its cap of ${MAX_ROWS}`);
    const own = (l: RepoLink) => l.repo === repo;
    const tickets = links.filter((l) => own(l) && l.fromKind === "pr" && l.fromRef === String(number) && l.toKind === "ticket").map((l) => ({ key: l.toRef, source: l.source }));
    const commits = links.filter((l) => own(l) && l.fromKind === "commit").map((l) => ({ sha: l.fromRef, source: l.source, verified: l.verified }));
    const state = r.id === undefined ? undefined : await h.syncState(r.id);

    const title = clip(d.title, TITLE_CHARS);
    if (title.cut) truncated.add(`title cut to ${TITLE_CHARS} characters`);
    /** A short field, cut at `chars` and flagged in `truncated`. */
    const field = (v: string | null, chars: number, name: string) => {
      if (v === null) return null;
      const c = clip(v, chars);
      if (c.cut) truncated.add(`${name} cut to ${chars} characters`);
      return c.text;
    };
    const head = {
      repo, number, kind: d.kind.toLowerCase(), title: title.text, state: d.state, author: field(d.authorLogin, 100, "author"), createdAt: d.createdAt, mergedAt: d.mergedAt, closedAt: d.closedAt,
      url: field(d.url, 500, "url"), mergeCommit: field(d.mergeCommitSha, 100, "mergeCommit"), syncedAt: state?.lastSuccessAt ?? null,
    };
    // Size budget, spent in order: header, body, tickets, commits, files, then comments with whatever is left.
    let left = MAX_BYTES - bytes(head) - 1200;
    const take = <T>(items: T[], max: number, name: string, limit = Infinity) => {
      const kept: T[] = [];
      let used = 2;
      for (const it of items.slice(0, max)) {
        const b = bytes(it) + 1;
        if (used + b > Math.min(limit, left)) break;
        kept.push(it);
        used += b;
      }
      left -= used;
      if (kept.length < items.length) truncated.add(`${name}: showing ${kept.length} of ${items.length}${items.length >= MAX_ROWS ? "+" : ""}`);
      return kept;
    };
    const body = clip(d.body, BODY_CHARS, Math.min(BODY_BYTES, left));
    left -= jsonBytes(body.text) + 10;
    if (body.cut) truncated.add(`body cut to ${BODY_CHARS} characters`);
    const out: Record<string, unknown> = { ...head, tickets: take(tickets, PER_KIND, "tickets", 1500), commits: take(commits, PER_KIND, "commits", 4000) };
    out.files = take(d.files.map((f) => ({ path: clip(f.path, 300).text, additions: f.additions, deletions: f.deletions })), FILES, "files", 6000);
    out.body = body.text;
    if (d.files.length >= MAX_ROWS) truncated.add(`files: the store returned its cap of ${MAX_ROWS}`);

    let nextOffset: number | null = null;
    if (includeComments) {
      if (d.comments.length >= MAX_ROWS) truncated.add(`comments: the store returned its cap of ${MAX_ROWS}`);
      const page = d.comments.slice(offset, offset + COMMENTS_PER_PAGE).map((c) => {
        const b = clip(c.body, COMMENT_CHARS, COMMENT_BYTES);
        if (b.cut) truncated.add(`comment text cut to ${COMMENT_CHARS} characters`);
        return { kind: c.kind, author: field(c.authorLogin, 100, "author"), createdAt: c.createdAt, state: c.state, path: field(c.path, 500, "path"), line: c.line, body: b.text };
      });
      let kept = take(page, COMMENTS_PER_PAGE, "comments (this page)");
      // A cut page must still move forward: the first comment of the page is always sent.
      if (!kept.length && page.length) kept = [page[0]!];
      out.comments = kept;
      nextOffset = offset + kept.length < d.comments.length ? offset + kept.length : null;
    }
    return done({ ...out, nextOffset, truncated: [...truncated] });
  },
});

// ---- search_discussions ----

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TIMED_OUT = "the search timed out; narrow the query";
/** Partial matches offered when an all-words search finds nothing. */
const PARTIALS = 5;
const KEY_QUERY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** A window of at most SNIPPET_CHARS characters around the first word found in `text`, or undefined. */
function snippet(text: string, re: RegExp) {
  const flat = text.replace(/\s+/g, " ");
  const m = re.exec(flat);
  if (!m) return undefined;
  const start = Math.max(0, m.index - 100);
  const body = flat.slice(start, start + SNIPPET_CHARS - 2);
  return `${start > 0 ? "…" : ""}${body}${start + body.length < flat.length ? "…" : ""}`;
}

function hitOf(repo: string, d: Discussion, words: string[], matchedIn?: string[]) {
  const re = words.length ? new RegExp(words.slice(0, MAX_WORDS).map((w) => escapeRe(w.slice(0, MAX_WORD))).join("|"), "i") : undefined;
  const has = (s: string | null | undefined) => !!re && !!s && re.test(s);
  const snippets: { in: string; text: string }[] = [];
  const texts = [{ in: "body", text: d.body }, ...d.comments.map((c) => ({ in: "comment", text: c.body }))];
  for (const x of re ? texts : []) {
    const s = snippets.length < SNIPPETS ? snippet(x.text, re!) : undefined;
    if (s) snippets.push({ in: x.in, text: s });
  }
  return {
    repo, number: d.number, kind: d.kind.toLowerCase(), title: clip(d.title, TITLE_CHARS).text, state: d.state, mergedAt: d.mergedAt, mergeCommit: d.mergeCommitSha,
    matchedIn: matchedIn ?? [has(d.title) && "title", has(d.body) && "body", d.comments.some((c) => has(c.body)) && "comment", has(d.headRef) && "branch"].filter((x): x is string => !!x),
    snippets,
  };
}

const searchDiscussions = define({
  name: "search_discussions",
  description: t.search_discussions!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    query: z.string().min(1).max(2000).describe(p("search_discussions", "query")),
    repo: z.string().describe(p("search_discussions", "repo")).optional(),
    kind: z.enum(["pr", "issue", "all"]).describe(p("search_discussions", "kind")).optional().default("all"),
    state: z.enum(["open", "closed", "merged"]).describe(p("search_discussions", "state")).optional(),
    since: iso.describe(p("search_discussions", "since")).optional(),
    until: iso.describe(p("search_discussions", "until")).optional(),
    page: z.number().int().positive().describe(p("search_discussions", "page")).optional().default(1),
    perPage: z.number().int().positive().max(20).describe(p("search_discussions", "perPage")).optional().default(20),
  }).strict(),
  async execute({ query, repo, kind = "all", state, since, until, page = 1, perPage = 20 }, ctx) {
    if (repo) await repoOrThrow(ctx, repo);
    const h = history(ctx);
    const names = await scopedNames(ctx);
    const words = query.split(/\s+/).filter(Boolean);
    if (!words.length) throw new Error("The query needs at least one word.");
    const truncated = new Set<string>();
    if (words.length > MAX_WORDS || words.some((w) => w.length > MAX_WORD)) truncated.add(`query cut to ${MAX_WORDS} words of ${MAX_WORD} characters`);
    const offset = (page - 1) * perPage;
    const filters = {
      kind: kind === "all" ? undefined : (kind.toUpperCase() as Discussion["kind"]),
      state,
      since: since ? new Date(since) : undefined,
      // a date alone includes the whole day
      until: until ? new Date(/T/.test(until) ? until : `${until}T23:59:59.999Z`) : undefined,
    };
    const keep = (d: Discussion) =>
      (!filters.kind || d.kind === filters.kind) && (!filters.state || d.state === filters.state) && (!filters.since || d.createdAt >= filters.since) && (!filters.until || d.createdAt <= filters.until);

    let hits: ReturnType<typeof hitOf>[] = [];
    let total = 0, totalCapped = false, hasMore = false, gaps: string[] | undefined;

    /** Exact lookups: the candidates are loaded (bounded), filtered, sorted like a search and paged. */
    const exact = async (candidates: { repo: string; number: number }[], words: string[], matchedIn: string[]) => {
      if (candidates.length > EXACT_LOADS) truncated.add(`exact lookup: only the first ${EXACT_LOADS} of ${candidates.length} candidates were read`);
      const loaded: { repo: string; d: Discussion }[] = [];
      for (const c of candidates.slice(0, EXACT_LOADS)) {
        // one repository's failed read must not hide the others
        const d = await h.getDiscussion(names, c.repo, c.number).catch(() => undefined);
        if (d && !("gap" in d) && keep(d)) loaded.push({ repo: c.repo, d });
      }
      loaded.sort((a, b) => b.d.updatedAt.getTime() - a.d.updatedAt.getTime() || a.repo.localeCompare(b.repo) || a.d.number - b.d.number);
      total = loaded.length;
      hasMore = offset + perPage < total;
      hits = loaded.slice(offset, offset + perPage).map((x) => hitOf(x.repo, x.d, words, matchedIn));
    };

    const num = words.length === 1 ? /^#(\d+)$/.exec(words[0]!) : null;
    if (num) {
      if (Number(num[1]) > MAX_NUMBER) throw new Error(`Pull request numbers go up to ${MAX_NUMBER}.`);
      gaps = await gapsOf(h, names, repo);
      const skip = new Set(gaps);
      const probe = (repo ? [repo] : names).filter((n) => !skip.has(notIngested(n)));
      await exact(probe.map((n) => ({ repo: n, number: Number(num[1]) })), [], ["number"]);
    } else if (words.length === 1 && KEY_QUERY.test(words[0]!)) {
      const r = await h.links(names, { kind: "ticket", key: words[0]! });
      gaps = r.gaps;
      if (r.links.length >= MAX_ROWS) truncated.add(`links: the store returned its cap of ${MAX_ROWS}`);
      const prs = r.links.filter((l) => l.fromKind === "pr" && (!repo || l.repo === repo)).map((l) => ({ repo: l.repo, number: Number(l.fromRef) }));
      if (prs.length) await exact(prs, words, ["ticket"]);
      else gaps = undefined; // not a known ticket: search the text below
    }

    if (gaps === undefined) {
      if (offset >= MAX_OFFSET) {
        gaps = await gapsOf(h, names, repo);
        truncated.add(`paging stops at ${MAX_OFFSET} results`);
      } else {
        const res = await h.search(names, { words, repo, limit: perPage, offset, ...filters });
        gaps = res.gaps;
        total = res.total;
        totalCapped = res.totalCapped;
        hasMore = res.hasMore;
        if (res.timedOut) truncated.add(TIMED_OUT);
        const loaded = await Promise.all(res.hits.map((x) => h.getDiscussion(names, x.repo, x.number)));
        hits = res.hits.map((x, i) => {
          const d = loaded[i];
          return d && !("gap" in d)
            ? hitOf(x.repo, d, words)
            : { repo: x.repo, number: x.number, kind: "pr", title: clip(x.title, TITLE_CHARS).text, state: x.state as Discussion["state"], mergedAt: x.mergedAt, mergeCommit: null, matchedIn: [], snippets: [] };
        });
      }
    }
    // All words are required: with none found, say so and offer the pull requests that have some of them.
    let hint: string | undefined, partialMatches: object[] | undefined;
    const searched = words.slice(0, MAX_WORDS).map((w) => w.slice(0, MAX_WORD));
    if (searched.length > 1 && total === 0 && offset < MAX_OFFSET && !truncated.has(TIMED_OUT)) {
      hint = "all words are required; try fewer or the title words";
      const res = await h.search(names, { words: searched, any: true, repo, limit: PARTIALS, ...filters });
      if (res.timedOut) truncated.add("the any-word search for partialMatches timed out");
      const found = await Promise.all(res.hits.slice(0, PARTIALS).map((x) => h.getDiscussion(names, x.repo, x.number)));
      partialMatches = res.hits.slice(0, PARTIALS).map((x, i) => {
        const d = found[i];
        const full = d && !("gap" in d) ? d : undefined;
        const matchedWords = searched.filter((w) => [x.title, full?.body, full?.headRef, ...(full?.comments.map((c) => c.body) ?? [])].some((s) => s?.toLowerCase().includes(w.toLowerCase())));
        return { repo: x.repo, number: x.number, title: clip(x.title, TITLE_CHARS).text, state: x.state, mergedAt: x.mergedAt, matchedWords };
      });
    }
    if (totalCapped) truncated.add(`totalCount stops at ${MAX_OFFSET}`);
    const result = () => ({ totalCount: total, totalCapped, page, perPage, hasMore, hits, hint, partialMatches, coverageGaps: gaps, truncated: [...truncated] });
    // Keep the answer inside the size bound by dropping snippets, last hit first.
    for (let i = hits.length - 1; bytes(result()) > MAX_BYTES && i >= 0; ) {
      if (hits[i]!.snippets.length) {
        hits[i]!.snippets.pop();
        truncated.add("snippets reduced to fit the size bound");
      } else i--;
    }
    return done(result());
  },
});

// ---- get_provenance ----

const SHA = /^[0-9a-fA-F]{40}$/;

const getProvenance = define({
  name: "get_provenance",
  description: t.get_provenance!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().describe(p("get_provenance", "repo")).optional(),
    commit: z.string().regex(SHA, "A commit must be a full 40-character SHA.").describe(p("get_provenance", "commit")).optional(),
    pr: z.number().int().positive().max(MAX_NUMBER).describe(p("get_provenance", "pr")).optional(),
    ticket: z.string().min(1).max(100).describe(p("get_provenance", "ticket")).optional(),
    path: z.string().min(1).describe(p("get_provenance", "path")).optional(),
    startLine: z.number().int().positive().describe(p("get_provenance", "startLine")).optional(),
    endLine: z.number().int().positive().describe(p("get_provenance", "endLine")).optional(),
  }).strict()
    .refine((a) => [a.commit, a.pr, a.ticket, a.path].filter((x) => x !== undefined).length === 1, "Pass exactly one of commit, pr, ticket or path.")
    .refine((a) => (a.pr === undefined && a.path === undefined) || a.repo !== undefined, "pr and path need repo.")
    .refine((a) => (a.startLine === undefined) === (a.endLine === undefined) && (a.startLine === undefined || a.path !== undefined), "startLine and endLine go together and only with path.")
    .refine((a) => a.startLine === undefined || a.endLine === undefined || a.startLine <= a.endLine, "startLine must not be after endLine."),
  async execute({ repo, commit, pr, ticket, path, startLine, endLine }, ctx) {
    const r = repo ? await repoOrThrow(ctx, repo) : undefined;
    const h = history(ctx);
    const names = await scopedNames(ctx);
    const truncated = new Set<string>();
    const lists = { commits: new Map<string, object>(), pullRequests: new Map<string, object>(), tickets: new Map<string, object>() };
    const add = (m: Map<string, object>, key: string, v: object) => void (m.has(key) || m.set(key, v));
    let anchor: object;
    let gaps: string[];

    if (path !== undefined) {
      const file = path.replace(/^\/+/, "");
      if (!isPathValid(file) || !file) throw fileNotFound(path, repo!);
      const span = startLine !== undefined ? ["-L", `${startLine},${endLine}:${file}`, "HEAD"] : ["HEAD", "--", file];
      let log: string;
      try {
        log = await git(r!, GIT_TIMEOUT_MS).raw(["--literal-pathspecs", "log", `--max-count=${PER_KIND}`, "--no-color", "-s", "--format=%H%x09%s", ...span]);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.includes("no such path")) throw fileNotFound(path, repo!);
        if (m.includes("has only")) throw new Error(`File "${path}" has fewer than ${endLine} lines in repository "${repo}".`);
        throw new Error(`Failed to read the history of "${path}" in repository "${repo}".`);
      }
      const rows = log.split("\n").filter(Boolean).map((l) => ({ sha: l.slice(0, 40), subject: clip(l.slice(41), TITLE_CHARS).text }));
      if (!rows.length) throw fileNotFound(path, repo!);
      if (rows.length >= PER_KIND) truncated.add(`commits: the newest ${PER_KIND} only`);
      for (const c of rows) add(lists.commits, c.sha, { repo, ...c });
      const found = await Promise.all(rows.map((c) => h.links(names, { kind: "commit", sha: c.sha })));
      found.forEach((f, i) => {
        for (const l of f.links) if (l.repo === repo) add(lists.pullRequests, `${l.toRepo ?? l.repo} ${l.toRef} ${rows[i]!.sha}`, { repo: l.toRepo ?? l.repo, number: Number(l.toRef), source: l.source, verified: l.verified, commit: rows[i]!.sha });
        if (f.links.length >= MAX_ROWS) truncated.add(`links: the store returned its cap of ${MAX_ROWS}`);
      });
      gaps = await gapsOf(h, names, repo);
      anchor = { repo, path: file, ...(startLine !== undefined ? { startLine, endLine } : {}) };
    } else {
      const a = commit ? ({ kind: "commit", sha: commit } as const) : pr !== undefined ? ({ kind: "pr", repo: repo!, number: pr } as const) : ({ kind: "ticket", key: ticket! } as const);
      const res = await h.links(names, a);
      if (res.links.length >= MAX_ROWS) truncated.add(`links: the store returned its cap of ${MAX_ROWS}`);
      gaps = repo ? res.gaps.filter((g) => g === notIngested(repo)) : res.gaps;
      for (const l of res.links) {
        if (repo && a.kind !== "pr" && l.repo !== repo) continue;
        const meta = { source: l.source, verified: l.verified };
        if (l.fromKind === "commit") add(lists.commits, `${l.repo} ${l.fromRef}`, { repo: l.repo, sha: l.fromRef, ...meta });
        else add(lists.pullRequests, `${l.repo} ${l.fromRef}`, { repo: l.repo, number: Number(l.fromRef), ...meta });
        if (l.toKind === "pr") add(lists.pullRequests, `${l.toRepo ?? l.repo} ${l.toRef}`, { repo: l.toRepo ?? l.repo, number: Number(l.toRef), ...meta });
        else add(lists.tickets, l.toRef, { key: l.toRef, ...meta });
      }
      // the anchor is not its own companion
      if (a.kind === "commit") for (const k of lists.commits.keys()) if (k.endsWith(` ${a.sha.toLowerCase()}`)) lists.commits.delete(k);
      if (a.kind === "pr") lists.pullRequests.delete(`${a.repo} ${a.number}`);
      if (a.kind === "ticket") lists.tickets.delete(a.key.toUpperCase());
      anchor = a.kind === "commit" ? { commit: a.sha.toLowerCase(), ...(repo ? { repo } : {}) } : a.kind === "pr" ? { repo: a.repo, pr: a.number } : { ticket: a.key.toUpperCase(), ...(repo ? { repo } : {}) };
    }
    const out: Record<string, unknown> = { anchor };
    for (const [kind, m] of Object.entries(lists)) {
      const all = [...m.values()];
      if (all.length > PER_KIND) truncated.add(`${kind}: showing ${PER_KIND} of ${all.length}`);
      out[kind] = all.slice(0, PER_KIND);
    }
    return done({ ...out, coverageGaps: gaps, truncated: [...truncated] });
  },
});

// ---- registry ----

export const historyToolDefinitions = {
  get_pull_request: getPullRequest,
  search_discussions: searchDiscussions,
  get_provenance: getProvenance,
} as const;

/** In MCP registration order, after the core tools. */
export const historyToolNames = Object.keys(historyToolDefinitions) as (keyof typeof historyToolDefinitions)[];

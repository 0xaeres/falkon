import { spawn } from "node:child_process";
import { z } from "zod";
import { mergePrNumber, squashPrNumber, ticketKeys as findTicketKeys } from "./provenance";
import { define, isPathValid, parseRelativeDate, type ToolContext } from "./tools";
import text from "./gitToolText.json" with { type: "json" };

/**
 * The git history tools (cycle 19, D167): registered only with MCP_GIT_TOOLS=on, in their own registry so the other tools and their
 * contract snapshots stay untouched. They read the local bare clones only, never the code host. Commit text is untrusted content.
 * This file also holds the bounded git runner and the repository fan-out every tool of the group uses.
 */

/** The limits every git tool works within, in one place. */
export const GIT_LIMITS = {
  /** Repositories read at the same time. */
  concurrency: 4,
  /** Time one repository may take. */
  repoMs: 15_000,
  /** Time the whole call may take; repositories not started by then are reported. */
  totalMs: 40_000,
  /** Repositories one call reads at most. */
  repos: 50,
  /** Bytes git may print for one repository before it is killed. */
  repoBytes: 4 * 1024 * 1024,
  /** About 24 KB of JSON per answer, as historyTools.ts. */
  answerBytes: 24_000,
} as const;

export interface GitRun {
  stdout: string;
  /** Which limit stopped git (it was killed and `stdout` is what was read up to then); undefined when git ended by itself. */
  limit?: "bytes" | "time";
  /** git's exit code; null when it was killed or could not start. */
  code: number | null;
}

/**
 * Runs `git` in `cwd` with `spawn` (never through simple-git) and kills it once it has printed `maxBytes` or has run for
 * `timeoutMs`. Returns at that moment with what was read, so a child of git (a hook, an alias) cannot hold the call open.
 * Arguments are not interpreted by a shell. The caller keeps every user-supplied value attached to its option (`--author=x`) or
 * after `--end-of-options` or `--`, so a leading dash cannot become an option.
 */
export function runGit(cwd: string, args: string[], o: { maxBytes: number; timeoutMs: number }): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = spawn("git", ["--no-pager", ...args], { cwd, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } });
    const chunks: Buffer[] = [];
    let size = 0, settled = false;
    const finish = (code: number | null, limit?: GitRun["limit"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (limit) child.kill("SIGKILL");
      resolve({ stdout: Buffer.concat(chunks).subarray(0, o.maxBytes).toString("utf8"), code, ...(limit ? { limit } : {}) });
    };
    const timer = setTimeout(() => finish(null, "time"), o.timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      chunks.push(b);
      size += b.length;
      if (size >= o.maxBytes) finish(null, "bytes");
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/**
 * Runs `fn` over at most `repos` items, `concurrency` at a time. An item not started before the total deadline is returned in
 * `late`; one that starts gets `min(repoMs, time left)` to finish. `overCap` counts the items beyond the cap, never run.
 * Results come back in input order.
 */
export async function fanOut<T, R>(
  items: T[],
  fn: (item: T, timeoutMs: number) => Promise<R>,
  o: { concurrency: number; repoMs: number; totalMs: number; repos: number } = GIT_LIMITS,
) {
  const deadline = Date.now() + o.totalMs;
  const run = items.slice(0, o.repos);
  const slots: ([T, R] | undefined)[] = new Array(run.length);
  const late: T[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < run.length; i = next++) {
      const left = deadline - Date.now();
      if (left <= 0) late.push(run[i]!);
      else slots[i] = [run[i]!, await fn(run[i]!, Math.min(o.repoMs, left))];
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, run.length) }, worker));
  return { done: slots.filter((s): s is [T, R] => !!s), late: run.filter((x) => late.includes(x)), overCap: items.length - run.length };
}

// ---- shared argument handling ----

const t = text as Record<string, { description: string; params: Record<string, string> }>;
const p = (tool: string, param: string) => t[tool]!.params[param]!;
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/** A free-text term: plain text, one line, no NUL (a NUL cannot be passed to a process). */
const term = z.string().min(1).max(200).refine((s) => !/[\0\r\n]/.test(s), "Terms are one line of plain text.");

const PLAIN_REF = /^[A-Za-z0-9._/@^~+-]+$/, REF_GLOB = /^[A-Za-z0-9._/*?[\]-]+$/;
/** Splits revisions into plain refs and ref globs; refuses an option look-alike, `..`, `--all`-style names and empty values. */
export function splitRevisions(revs: string[]) {
  const plain: string[] = [], globs: string[] = [];
  for (const r of revs) {
    const glob = /[*?[]/.test(r);
    if (!r || r.startsWith("-") || r.includes("..") || !(glob ? REF_GLOB : PLAIN_REF).test(r)) throw new Error(`Revision "${r}" is not accepted: give a branch, tag, commit id or ref glob; it may not be empty, start with "-" or contain "..".`);
    (glob ? globs : plain).push(r);
  }
  return { plain, globs };
}

/** A date for git: the existing relative-date helper, then a check that it really is a date. A date-only `before` includes that whole day. */
function gitDate(label: string, s: string | undefined, endOfDay = false) {
  if (s === undefined) return undefined;
  const iso = parseRelativeDate(s);
  const ms = iso === undefined ? NaN : Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`${label} "${s}" is not a date. Use ISO 8601 such as 2024-02-01, or "3 days ago".`);
  return new Date(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? ms + 86_400_000 - 1 : ms);
}

/** Escapes every regular-expression metacharacter so git's -G pattern matches the terms literally. */
export const literalPattern = (terms: string[]) => terms.map((x) => x.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&")).join("|");

// ---- search_commits ----

const MESSAGE_CHARS = 2000, SUBJECT_CHARS = 300, DEFAULT_COUNT = 50;
const FORMAT = "--format=%H%x1f%ct%x1f%an%x1f%B";
const tickets = (ctx: ToolContext) => ctx.deps.ticketKeys ?? [];
const notFound = (name: string) => `repository "${name}" not found`;

const searchCommits = define({
  name: "search_commits",
  description: t.search_commits!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repos: z.array(z.string().min(1)).max(200).describe(p("search_commits", "repos")).optional(),
    revisions: z.array(z.string()).max(20).describe(p("search_commits", "revisions")).optional(),
    authors: z.array(term).max(5).describe(p("search_commits", "authors")).optional(),
    messageTerms: z.array(term).max(10).describe(p("search_commits", "messageTerms")).optional(),
    contentTerms: z.array(term).max(10).describe(p("search_commits", "contentTerms")).optional(),
    files: z.array(z.string().min(1).max(500)).max(20).describe(p("search_commits", "files")).optional(),
    after: z.string().describe(p("search_commits", "after")).optional(),
    before: z.string().describe(p("search_commits", "before")).optional(),
    count: z.number().int().min(1).max(100).describe(p("search_commits", "count")).optional().default(DEFAULT_COUNT),
  }).strict(),
  async execute(a, ctx) {
    const count = a.count ?? DEFAULT_COUNT;
    const { plain, globs } = splitRevisions(a.revisions ?? []);
    const bad = a.files?.find((f) => !isPathValid(f));
    if (bad !== undefined) throw new Error(`File "${bad}" is not accepted: no ".." segments or NUL.`);
    const after = gitDate("after", a.after), before = gitDate("before", a.before, true);
    if (after && before && after > before) throw new Error(`"after" (${a.after}) is later than "before" (${a.before}); no commit can match.`);
    if (a.contentTerms?.length && !(a.after || a.before || a.files?.length || a.repos?.length))
      throw new Error("contentTerms read every diff, so they need a narrowing filter: after, before, files or repos.");

    const argv = [
      "--literal-pathspecs", "log", "-z", FORMAT, `--max-count=${count}`, "--fixed-strings", "-i",
      ...(a.authors ?? []).map((x) => `--author=${x}`),
      ...(a.messageTerms ?? []).map((x) => `--grep=${x}`),
      ...(a.contentTerms?.length ? [`-G${literalPattern(a.contentTerms)}`] : []),
      ...(after ? [`--since=${after.toISOString()}`] : []),
      ...(before ? [`--until=${before.toISOString()}`] : []),
      ...globs.map((g) => `--glob=${g}`),
      "--end-of-options", ...(plain.length || globs.length ? plain : ["HEAD"]),
      ...(a.files?.length ? ["--", ...a.files] : []),
    ];

    // Repositories: the named ones, else the chat's selection, else every visible one. A name the scope excludes reads like a missing one.
    const visible = (await ctx.deps.listRepos({ sort: "name", direction: "asc" })).filter((r) => ctx.scope.allows(r.name));
    const names = [...new Set(a.repos ?? ctx.selectedRepos ?? visible.map((r) => r.name))];
    const gaps: string[] = [];
    const repos = [];
    for (const n of names) {
      const r = ctx.scope.allows(n) ? await ctx.deps.getRepo(n) : undefined;
      if (r) repos.push(r); else gaps.push(notFound(n));
    }

    const ran = await fanOut(repos, async (r, timeoutMs) => {
      const g = await runGit(r.path, argv, { maxBytes: GIT_LIMITS.repoBytes, timeoutMs });
      const parts = g.stdout.split("\0");
      parts.pop(); // after the last NUL: empty when git finished, a partial record when it was cut
      return { g, commits: parts.filter(Boolean).map((rec) => parseCommit(r.name, rec, tickets(ctx))) };
    });
    const all = [];
    for (const [r, { g, commits }] of ran.done) {
      if (g.limit === "time") gaps.push(`${r.name}: timed out after ${GIT_LIMITS.repoMs / 1000} seconds; its commits may be missing`);
      else if (g.limit === "bytes") gaps.push(`${r.name}: output cut at ${GIT_LIMITS.repoBytes} bytes; its commits may be missing`);
      else if (g.code !== 0) gaps.push(`${r.name}: git could not read the requested revisions`);
      all.push(...commits);
    }
    for (const r of ran.late) gaps.push(`${r.name}: not started before the ${GIT_LIMITS.totalMs / 1000} second deadline`);
    if (ran.overCap) gaps.push(`${ran.overCap} repositories skipped: at most ${GIT_LIMITS.repos} are read per call`);

    all.sort((x, y) => y.ts - x.ts || x.repo.localeCompare(y.repo) || x.hash.localeCompare(y.hash));
    const truncated: string[] = [];
    let shown = all.slice(0, count).map(({ ts: _ts, ...c }) => c);
    if (all.length > shown.length) truncated.push(`commits: showing ${shown.length} of ${all.length} found`);
    const filters = { repos: names, revisions: a.revisions ?? ["HEAD"], authors: a.authors, messageTerms: a.messageTerms, contentTerms: a.contentTerms, files: a.files, after: a.after, before: a.before, count };
    const out = () => ({ commits: shown, filters, coverageGaps: gaps, truncated });
    while (shown.length && bytes(out()) > GIT_LIMITS.answerBytes) {
      shown = shown.slice(0, Math.max(0, shown.length - Math.ceil(shown.length / 10)));
      truncated[0] = `commits: answer byte cap reached; showing ${shown.length} of ${all.length} found`;
    }
    return { output: JSON.stringify(out()) };
  },
});

function parseCommit(repo: string, rec: string, keys: string[]) {
  const [hash = "", ts = "0", author = "", ...rest] = rec.split("\x1f");
  const message = rest.join("\x1f").trim();
  const subject = message.split("\n", 1)[0]!;
  const prs = [squashPrNumber(subject), mergePrNumber(subject)].filter((n): n is number => n !== undefined);
  const cut = message.length > MESSAGE_CHARS;
  return {
    ts: Number(ts), repo, hash, date: new Date(Number(ts) * 1000).toISOString(), author,
    subject: subject.slice(0, SUBJECT_CHARS),
    message: cut ? message.slice(0, MESSAGE_CHARS).replace(/[\ud800-\udbff]$/, "") : message,
    ...(cut ? { messageCut: `message cut to ${MESSAGE_CHARS} characters` } : {}),
    ticketKeys: findTicketKeys(message, keys),
    pullRequests: prs,
    linksSource: "message, unverified",
  };
}

// ---- registry ----

export const gitToolDefinitions = { search_commits: searchCommits } as const;

/** In MCP registration order, after the pull request history tools. */
export const gitToolNames = Object.keys(gitToolDefinitions) as (keyof typeof gitToolDefinitions)[];

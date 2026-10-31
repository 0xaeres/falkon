import { z } from "zod";
import { mergePrNumber, squashPrNumber, ticketKeys as findTicketKeys } from "./provenance";
import { define, isPathValid, parseRelativeDate, repoOrThrow, type ToolContext, type ToolRepo } from "./tools";
import { GIT_LIMITS, runGit, cutMiddle, type GitRun } from "./gitRun";
import text from "./gitToolText.json" with { type: "json" };

/**
 * The git history tools (cycle 19, D167): registered only with MCP_GIT_TOOLS=on, in their own registry so the other tools and their
 * contract snapshots stay untouched. They read the local bare clones only, never the code host. Commit text is untrusted content.
 * This file also holds the repository fan-out every tool of the group uses; the bounded git runner is in gitRun.ts.
 */

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
function splitRevisions(revs: string[]) {
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
const literalPattern = (terms: string[]) => terms.map((x) => x.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&")).join("|");

// ---- filters, repositories and the answer cap that search_commits and search_diffs share ----

type Common = { repos?: string[]; revisions?: string[]; authors?: string[]; files?: string[]; after?: string; before?: string };
type Lim = { [K in keyof typeof GIT_LIMITS]: number };

/** Checks the revisions, files and dates; the tools then add their own checks. */
function checkFilters(a: Common) {
  const { plain, globs } = splitRevisions(a.revisions ?? []);
  const bad = a.files?.find((f) => !isPathValid(f));
  if (bad !== undefined) throw new Error(`File "${bad}" is not accepted: no ".." segments or NUL.`);
  const after = gitDate("after", a.after), before = gitDate("before", a.before, true);
  if (after && before && after > before) throw new Error(`"after" (${a.after}) is later than "before" (${a.before}); no commit can match.`);
  return { plain, globs, after, before };
}

/** Reading every diff in range needs a narrowing filter. */
function needNarrowing(a: Common, what: string) {
  if (!(a.after || a.before || a.files?.length || a.repos?.length)) throw new Error(`${what} read every diff, so they need a narrowing filter: after, before, files or repos.`);
}

/** The `git log` arguments of both tools. Every caller string is attached to its option, or comes after `--end-of-options` or `--`. */
const logArgv = (a: Common, v: ReturnType<typeof checkFilters>, head: string[], pickaxe: string[]) => [
  "-c", "core.quotePath=false", "--literal-pathspecs", "log", ...head, "--fixed-strings", "-i",
  ...(a.authors ?? []).map((x) => `--author=${x}`),
  ...pickaxe,
  ...(v.after ? [`--since=${v.after.toISOString()}`] : []),
  ...(v.before ? [`--until=${v.before.toISOString()}`] : []),
  ...v.globs.map((g) => `--glob=${g}`),
  "--end-of-options", ...(v.plain.length || v.globs.length ? v.plain : ["HEAD"]),
  ...(a.files?.length ? ["--", ...a.files] : []),
];

const notFound = (name: string) => `repository "${name}" not found`;

/** Repositories: the named ones, else the chat's selection, else every visible one. A name the scope excludes reads like a missing one. At most `lim.repos` are looked up. */
async function pickRepos(requested: string[] | undefined, ctx: ToolContext, lim: Lim) {
  const visible = (await ctx.deps.listRepos({ sort: "name", direction: "asc" })).filter((r) => ctx.scope.allows(r.name));
  const wanted = [...new Set(requested ?? ctx.selectedRepos ?? visible.map((r) => r.name))];
  const names = wanted.slice(0, lim.repos);
  const gaps: string[] = wanted.length > names.length ? [`${wanted.length - names.length} repositories skipped: at most ${lim.repos} are read per call`] : [];
  const repos: ToolRepo[] = [];
  for (const n of names) {
    const r = ctx.scope.allows(n) ? await ctx.deps.getRepo(n) : undefined;
    if (r) repos.push(r); else gaps.push(notFound(n));
  }
  return { names, repos, gaps };
}

/** What a stopped or failed git run means for the answer, or nothing when it ended well. */
function runGap(name: string, g: GitRun, lim: Lim, what = "its commits") {
  if (g.limit === "time") return `${name}: timed out after ${lim.repoMs / 1000} seconds; ${what} may be missing`;
  if (g.limit === "bytes") return `${name}: output cut at ${lim.repoBytes} bytes; ${what} may be missing`;
  if (g.code !== 0) return `${name}: git could not read the requested revisions`;
}

/**
 * The JSON answer for a list tool, kept under the byte cap: trim the items first, then the echo of the filters, then the gaps.
 * `items` is the newest-first list already cut to `count`; `found` is how many existed.
 */
function listAnswer<T>(key: string, items: T[], found: number, filters: Record<string, unknown>, repoCount: number, gaps: string[], summary?: string) {
  const truncated: string[] = [];
  let shown = items;
  if (found > shown.length) truncated.push(`${key}: showing ${shown.length} of ${found} found`);
  const out = () => ({ ...(summary ? { summary } : {}), [key]: shown, filters, coverageGaps: gaps, truncated });
  const over = () => bytes(out()) > GIT_LIMITS.answerBytes;
  const cut = (what: string) => truncated.push(`${what}: answer byte cap reached`);
  if (over()) {
    while (shown.length && over()) shown = shown.slice(0, shown.length - Math.ceil(shown.length / 10));
    truncated.push(`${key}: answer byte cap reached; showing ${shown.length} of ${found} found`);
  }
  if (over()) { filters = { repos: repoCount, note: "filters not echoed" }; cut("filters"); }
  if (over()) { const n = gaps.length; while (gaps.length && over()) gaps.length = Math.floor(gaps.length / 2); gaps.push(`${n - gaps.length} more gaps not shown`); cut("coverageGaps"); }
  return JSON.stringify(out());
}

/** One time allowance for all the git runs of a single-repository call; a run that hits it is an error saying `what` was being done, unless the caller takes the partial output (`soft`) and reports a gap. */
function timedGit(cwd: string, lim: Lim, what: string) {
  const deadline = Date.now() + lim.repoMs;
  return async (argv: string[], maxBytes = lim.repoBytes, soft = false) => {
    const g = await runGit(cwd, argv, { maxBytes, timeoutMs: Math.max(1, deadline - Date.now()) });
    if (g.limit === "time" && !soft) throw new Error(`git timed out after ${lim.repoMs / 1000} seconds ${what}`);
    return g;
  };
}

/** The commit a revision names (a tag is followed to its commit); `unresolved` says why it names none; `run` is any other git failure (damaged repository, a limit). */
async function resolveCommit(git: (argv: string[], maxBytes: number) => Promise<GitRun>, rev: string): Promise<{ sha: string } | { unresolved: string } | { run: GitRun }> {
  const g = await git(["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`], 2000);
  const sha = g.stdout.trim();
  if (g.code === 0 && sha) return { sha };
  if (g.code === 128 && !g.limit && /Needed a single revision/.test(g.stderr)) return { unresolved: /ambiguous/.test(g.stderr) ? "ambiguous: more than one object starts with these characters, give more of them" : "not found in this repository" };
  return { run: g };
}

// ---- search_commits ----

const MESSAGE_CHARS = 2000, SUBJECT_CHARS = 300, DEFAULT_COUNT = 50;
const FORMAT = "--format=%H%x1f%ct%x1f%an%x1f%B";
const tickets = (ctx: ToolContext) => ctx.deps.ticketKeys ?? [];

const searchCommits = define({
  name: "search_commits",
  description: t.search_commits!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repos: z.array(z.string().min(1).max(300)).max(200).describe(p("search_commits", "repos")).optional(),
    revisions: z.array(z.string().max(300)).max(20).describe(p("search_commits", "revisions")).optional(),
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
    const v = checkFilters(a);
    if (a.contentTerms?.length) needNarrowing(a, "contentTerms");
    const argv = logArgv(a, v, ["-z", FORMAT, `--max-count=${count}`], [
      ...(a.messageTerms ?? []).map((x) => `--grep=${x}`),
      ...(a.contentTerms?.length ? [`-G${literalPattern(a.contentTerms)}`] : []),
    ]);

    const lim = { ...GIT_LIMITS, ...ctx.deps.gitLimits };
    const { names, repos, gaps } = await pickRepos(a.repos, ctx, lim);
    const ran = await fanOut(repos, async (r, timeoutMs) => {
      const g = await runGit(r.path, argv, { maxBytes: lim.repoBytes, timeoutMs });
      const parts = g.stdout.split("\0");
      parts.pop(); // after the last NUL: empty when git finished, a partial record when it was cut
      return { g, commits: parts.filter(Boolean).map((rec) => parseCommit(r.name, rec, tickets(ctx))) };
    }, lim);
    const all = [];
    for (const [r, { g, commits }] of ran.done) {
      const gap = runGap(r.name, g, lim);
      if (gap) gaps.push(gap);
      all.push(...commits);
    }
    for (const r of ran.late) gaps.push(`${r.name}: not started before the ${lim.totalMs / 1000} second deadline`);

    all.sort((x, y) => y.ts - x.ts || x.repo.localeCompare(y.repo) || x.hash.localeCompare(y.hash));
    const filters = { repos: names, revisions: a.revisions ?? ["HEAD"], authors: a.authors, messageTerms: a.messageTerms, contentTerms: a.contentTerms, files: a.files, after: a.after, before: a.before, count };
    return { output: listAnswer("commits", all.slice(0, count).map(({ ts: _ts, ...c }) => c), all.length, filters, names.length, gaps) };
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

// ---- search_diffs ----

const MATCHES_PER_COMMIT = 5, LINE_CHARS = 200;
const DIFF_FORMAT = "--format=%x01%H%x1f%ct%x1f%an%x1f%s"; // a record starts with a line that begins with \x01, which no diff line can

const searchDiffs = define({
  name: "search_diffs",
  description: t.search_diffs!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repos: z.array(z.string().min(1).max(300)).max(200).describe(p("search_diffs", "repos")).optional(),
    revisions: z.array(z.string().max(300)).max(20).describe(p("search_diffs", "revisions")).optional(),
    terms: z.array(term).min(1).max(10).describe(p("search_diffs", "terms")),
    side: z.enum(["added", "removed", "both"]).describe(p("search_diffs", "side")).optional().default("both"),
    files: z.array(z.string().min(1).max(500)).max(20).describe(p("search_diffs", "files")).optional(),
    authors: z.array(term).max(5).describe(p("search_diffs", "authors")).optional(),
    after: z.string().describe(p("search_diffs", "after")).optional(),
    before: z.string().describe(p("search_diffs", "before")).optional(),
    count: z.number().int().min(1).max(100).describe(p("search_diffs", "count")).optional().default(DEFAULT_COUNT),
  }).strict(),
  async execute(a, ctx) {
    const count = a.count ?? DEFAULT_COUNT, side = a.side ?? "both";
    const v = checkFilters(a);
    needNarrowing(a, "search_diffs terms");
    // git's own count stops the log early only when no side filter can drop a commit afterwards
    const argv = logArgv(a, v, [DIFF_FORMAT, "-p", "-U0", ...(side === "both" ? [`--max-count=${count}`] : [])], [`-G${literalPattern(a.terms)}`]);
    const needles = a.terms.map((x) => x.toLowerCase());

    const lim = { ...GIT_LIMITS, ...ctx.deps.gitLimits };
    const { names, repos, gaps } = await pickRepos(a.repos, ctx, lim);
    const ran = await fanOut(repos, async (r, timeoutMs) => {
      const g = await runGit(r.path, argv, { maxBytes: lim.repoBytes, timeoutMs });
      const recs = g.stdout.split(/^\x01/m).slice(1);
      if (g.limit) recs.pop(); // a cut run ends inside a record
      return { g, commits: recs.map((rec) => parseDiffRecord(r.name, rec, needles, side)).filter((c) => c !== undefined) };
    }, lim);
    const all = [];
    for (const [r, { g, commits }] of ran.done) {
      const gap = runGap(r.name, g, lim);
      if (gap) gaps.push(gap);
      all.push(...commits);
    }
    for (const r of ran.late) gaps.push(`${r.name}: not started before the ${lim.totalMs / 1000} second deadline`);

    all.sort((x, y) => y.ts - x.ts || x.repo.localeCompare(y.repo) || x.hash.localeCompare(y.hash));
    const filters = { repos: names, revisions: a.revisions ?? ["HEAD"], terms: a.terms, side, authors: a.authors, files: a.files, after: a.after, before: a.before, count };
    return { output: listAnswer("commits", all.slice(0, count).map(({ ts: _ts, ...c }) => c), all.length, filters, names.length, gaps) };
  },
});

const cutChars = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/[\ud800-\udbff]$/, "") : s);
const C_ESCAPES: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
/** A path from a `---`/`+++` line: git's C-style quoting (octal bytes, \t, \", \\) undone, the `a/` or `b/` prefix removed. */
const pathOf = (s: string, prefix: string) => {
  let f = s.replace(/\t$/, "");
  if (/^".*"$/.test(f)) f = Buffer.concat(Array.from(f.slice(1, -1).matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/gs), ([, oct, esc, raw]) => oct ? Buffer.from([parseInt(oct, 8)]) : Buffer.from(esc ? C_ESCAPES[esc] ?? esc : raw!))).toString("utf8");
  return f === "/dev/null" ? "" : f.startsWith(prefix) ? f.slice(2) : f;
};

/** One log record: the header line, then the `-U0` diff. Only changed lines are looked at, so context never matches. */
function parseDiffRecord(repo: string, rec: string, needles: string[], side: "added" | "removed" | "both") {
  const lines = rec.split("\n");
  const [hash = "", ts = "0", author = "", ...subject] = lines[0]!.split("\x1f");
  const found: { file: string; side: "added" | "removed"; line: number; text: string }[] = [];
  let file = "", from = "", header = false, oldLn = 0, newLn = 0;
  for (const l of lines.slice(1)) {
    if (l.startsWith("diff --git ")) { header = true; file = from = ""; continue; }
    if (l.startsWith("@@")) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
      if (h) { oldLn = Number(h[1]); newLn = Number(h[2]); }
      header = false;
      continue;
    }
    if (header) {
      if (l.startsWith("--- ")) from = pathOf(l.slice(4), "a/");
      else if (l.startsWith("+++ ")) file = pathOf(l.slice(4), "b/") || from;
      continue;
    }
    const sign = l[0];
    if (sign !== "+" && sign !== "-") continue;
    const text = l.slice(1), kind = sign === "+" ? "added" : "removed";
    const n = kind === "added" ? newLn++ : oldLn++;
    if ((side === "both" || side === kind) && needles.some((x) => text.toLowerCase().includes(x))) found.push({ file, side: kind, line: n, text });
  }
  if (!found.length) return undefined;
  const subjectText = subject.join("\x1f");
  return {
    ts: Number(ts), repo, hash, date: new Date(Number(ts) * 1000).toISOString(), author, subject: cutChars(subjectText, SUBJECT_CHARS),
    sides: ["added", "removed"].filter((k) => found.some((f) => f.side === k)),
    matchCount: found.length,
    matches: found.slice(0, MATCHES_PER_COMMIT).map((f) => ({ ...f, text: cutChars(f.text, LINE_CHARS), ...(f.text.length > LINE_CHARS ? { textCut: true } : {}) })),
  };
}

// ---- compare_revisions ----

const STATUS: Record<string, string> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type changed" };
/** Smallest share of the answer worth giving a file's diff; below it the diff is left out. */
const MIN_FILE_DIFF = 200;

/** A branch, tag or commit id; a ref glob or anything option-like is refused. */
function oneRevision(rev: string) {
  const { plain } = splitRevisions([rev]);
  if (plain.length !== 1) throw new Error(`Revision "${rev}" is not accepted: give one branch, tag or commit id, not a glob.`);
  return rev;
}

const compareRevisions = define({
  name: "compare_revisions",
  description: t.compare_revisions!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().min(1).max(300).describe(p("compare_revisions", "repo")),
    base: z.string().max(300).describe(p("compare_revisions", "base")),
    head: z.string().max(300).describe(p("compare_revisions", "head")),
    files: z.array(z.string().min(1).max(500)).max(20).describe(p("compare_revisions", "files")).optional(),
    page: z.number().int().min(1).describe(p("compare_revisions", "page")).optional().default(1),
    perPage: z.number().int().min(1).max(100).describe(p("compare_revisions", "perPage")).optional().default(DEFAULT_COUNT),
  }).strict(),
  async execute(a, ctx) {
    const page = a.page ?? 1, perPage = a.perPage ?? DEFAULT_COUNT;
    const revs = [oneRevision(a.base), oneRevision(a.head)];
    const bad = a.files?.find((f) => !isPathValid(f));
    if (bad !== undefined) throw new Error(`File "${bad}" is not accepted: no ".." segments or NUL.`);
    const r = await repoOrThrow(ctx, a.repo);
    const lim = { ...GIT_LIMITS, ...ctx.deps.gitLimits };
    const gaps: string[] = [], truncated: string[] = [];
    const git = timedGit(r.path, lim, `comparing ${a.base} and ${a.head} in "${a.repo}"; try fewer files or closer revisions.`);

    const commits: string[] = [];
    for (const rev of revs) {
      const x = await resolveCommit(git, rev);
      if ("unresolved" in x) throw new Error(`Revision "${rev}" not found in repository "${a.repo}".`);
      if ("run" in x) throw new Error(`git could not read revision "${rev}" in repository "${a.repo}".`);
      commits.push(x.sha);
    }
    const [from, to] = commits as [string, string];
    const paths = a.files?.length ? ["--", ...a.files] : [];
    const echo = { repo: a.repo, base: { revision: a.base, commit: from }, head: { revision: a.head, commit: to } };

    // The file list: statuses and paths, in path order.
    const list = await git(["-c", "core.quotePath=false", "--literal-pathspecs", "diff", "--name-status", "-z", "-M", "--end-of-options", from, to, ...paths]);
    const tok = list.stdout.split("\0");
    const entries: { status: string; path: string; oldPath?: string }[] = [];
    for (let i = 0; i + 1 < tok.length;) {
      const code = tok[i++]!, renamed = code[0] === "R" || code[0] === "C";
      const oldPath = renamed ? tok[i++] : undefined, path = tok[i++];
      if (path === undefined) break;
      entries.push({ status: STATUS[code[0]!] ?? code, path, ...(oldPath !== undefined ? { oldPath } : {}) });
    }
    if (list.limit) { entries.pop(); gaps.push(`${a.repo}: file list cut at ${lim.repoBytes} bytes; later files are missing`); }
    else if (list.code !== 0) throw new Error(`git could not compare "${a.base}" and "${a.head}" in "${a.repo}".`);

    const totalFiles = entries.length, totalPages = Math.ceil(totalFiles / perPage);
    const result = (files: unknown[], summary?: string) => JSON.stringify({ ...echo, ...(summary ? { summary } : {}), files, page, perPage, totalFiles, totalPages, coverageGaps: gaps, truncated });
    if (!totalFiles) return { output: result([], from === to ? "No differences: base and head are the same commit." : "No differences between base and head.") };
    if (page > totalPages) return { output: result([], `Page ${page} is beyond the last page (${totalPages}); there are ${totalFiles} files.`) };

    // The diffs of this page's files (both names of a rename, so git pairs them again).
    const mine = entries.slice((page - 1) * perPage, page * perPage);
    const d = await git(["--literal-pathspecs", "diff", "-M", "--no-color", "--end-of-options", from, to, "--", ...mine.flatMap((e) => (e.oldPath ? [e.oldPath, e.path] : [e.path]))]);
    const sections = d.stdout.split(/^(?=diff --git )/m).filter(Boolean);
    const need = (e: { status: string }) => (e.status === "type changed" ? 2 : 1); // a type change is a delete and an add of one path
    const whole = d.code === 0 && sections.length === mine.reduce((n, e) => n + need(e), 0);
    if (d.limit) { sections.pop(); gaps.push(`${a.repo}: diffs cut at ${lim.repoBytes} bytes; the last files of this page have no diff`); }
    else if (!whole) gaps.push(`${a.repo}: git could not read the diffs of this page; the files are listed without them`);
    const usable = d.limit || whole ? sections : [];
    let at = 0;
    const items = mine.map((e) => {
      const secs = usable.slice(at, at += need(e)), sec = secs.length === need(e) ? secs.join("") : undefined;
      const body = secs.length === need(e) ? secs.flatMap((x) => { const h = x.search(/^@@/m); return h >= 0 ? x.slice(h).split("\n") : []; }) : [];
      return { meta: { ...e, additions: body.filter((l) => l[0] === "+").length, deletions: body.filter((l) => l[0] === "-").length, ...(sec && /^(Binary files .* differ|GIT binary patch)$/m.test(sec) ? { binary: true } : {}) }, diff: sec };
    });

    // Fit the page into one answer: shrink every diff, then leave diffs out, then drop files from the end of the page.
    const build = (n: number, cap: number) => items.slice(0, n).map(({ meta, diff }) => {
      if (diff === undefined || cap < MIN_FILE_DIFF) return { ...meta, diffOmitted: true };
      const cut = cutMiddle(diff, cap);
      return { ...meta, diff: cut, ...(cut !== diff ? { diffCut: true } : {}) };
    });
    let n = items.length, cap = Math.floor(GIT_LIMITS.answerBytes / n);
    while (n > 0 && Buffer.byteLength(result(build(n, cap))) > GIT_LIMITS.answerBytes - 300) { // 300 bytes of room for the note below
      if (cap >= MIN_FILE_DIFF) cap = Math.floor(cap * 0.8);
      else n -= Math.max(1, Math.floor(n / 10));
    }
    if (n < items.length) truncated.push(`files: answer byte cap reached; showing ${n} of ${items.length} on this page, ask for a smaller perPage`);
    return { output: result(build(n, cap)) };
  },
});

// ---- list_refs ----

const REF_COUNT = 100, REF_FORMAT = "--format=%(refname)%1f%(objectname)%1f%(objecttype)%1f%(*objectname)%1f%(*objecttype)%1f%(creatordate:unix)";
const REF_KINDS = { heads: ["refs/heads/"], tags: ["refs/tags/"], both: ["refs/heads/", "refs/tags/"] } as const;

const listRefs = define({
  name: "list_refs",
  description: t.list_refs!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repos: z.array(z.string().min(1).max(300)).max(200).describe(p("list_refs", "repos")).optional(),
    kind: z.enum(["heads", "tags", "both"]).describe(p("list_refs", "kind")).optional().default("both"),
    contains: z.string().max(300).describe(p("list_refs", "contains")).optional(),
    count: z.number().int().min(1).max(500).describe(p("list_refs", "count")).optional().default(REF_COUNT),
  }).strict(),
  async execute(a, ctx) {
    const kind = a.kind ?? "both", count = a.count ?? REF_COUNT;
    const contains = a.contains === undefined ? undefined : oneRevision(a.contains);
    const lim = { ...GIT_LIMITS, ...ctx.deps.gitLimits };
    const { names, repos, gaps } = await pickRepos(a.repos, ctx, lim);
    const ran = await fanOut(repos, async (r, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      const git = (argv: string[], maxBytes: number) => runGit(r.path, argv, { maxBytes, timeoutMs: Math.max(1, deadline - Date.now()) });
      let sha: string | undefined;
      if (contains !== undefined) {
        const x = await resolveCommit(git, contains);
        if ("unresolved" in x) return { gap: `${r.name}: revision "${contains}" could not be resolved: ${x.unresolved}`, refs: [], found: 0 };
        if ("run" in x) return { gap: runGap(r.name, x.run, lim, "its refs") ?? `${r.name}: git could not read revision "${contains}"`, refs: [], found: 0 };
        sha = x.sha;
      }
      const select = [...(sha ? [`--contains=${sha}`] : []), ...REF_KINDS[kind]];
      // the overall top `count` lies within each repository's top `count`, so git need not print more
      const g = await git(["for-each-ref", `--count=${count}`, "--sort=refname", "--sort=-creatordate", REF_FORMAT, ...select], lim.repoBytes);
      const lines = g.stdout.split("\n");
      if (g.limit) lines.pop(); // a cut run ends inside a record
      const refs = lines.filter(Boolean).map((l) => parseRef(r.name, l));
      let gap = runGap(r.name, g, lim, "its refs"), found = refs.length;
      if (refs.length >= count) { // maybe more: count them with one empty line per ref
        const n = await git(["for-each-ref", "--format=", ...select], lim.repoBytes);
        found = Math.max(n.stdout.split("\n").length - 1, refs.length); // a cut count is a lower bound, never below what is shown
        gap ??= runGap(r.name, n, lim, "its refs");
      }
      return { gap, refs, found };
    }, lim);
    const all = [];
    let found = 0;
    for (const [, { gap, refs, found: n }] of ran.done) { if (gap) gaps.push(gap); all.push(...refs); found += n; }
    for (const r of ran.late) gaps.push(`${r.name}: not started before the ${lim.totalMs / 1000} second deadline`);

    all.sort((x, y) => y.ts - x.ts || x.repo.localeCompare(y.repo) || x.name.localeCompare(y.name) || x.kind.localeCompare(y.kind));
    const filters = { repos: names, kind, contains: a.contains, count };
    const summary = all.length || gaps.length ? undefined : `No ${kind === "heads" ? "branches" : kind === "tags" ? "tags" : "refs"} found${contains ? ` that contain ${contains}` : ""} in the repositories read.`;
    return { output: listAnswer("refs", all.slice(0, count).map(({ ts: _ts, ...x }) => x), found, filters, names.length, gaps, summary) };
  },
});

/** `target` is the object the ref finally reaches (a tag is followed through any chain of tags); `targetType` only when that is not a commit. */
function parseRef(repo: string, line: string) {
  const [ref = "", obj = "", type = "", peeled = "", peeledType = "", ts = "0"] = line.split("\x1f");
  const kind = ref.startsWith("refs/tags/") ? "tag" : "branch", targetType = peeled ? peeledType : type;
  return {
    ts: Number(ts), repo, kind, name: ref.replace(/^refs\/(heads|tags)\//, ""), target: peeled || obj, ...(targetType !== "commit" ? { targetType } : {}),
    date: new Date(Number(ts) * 1000).toISOString(),
  };
}

// ---- check_ancestry ----

const checkAncestry = define({
  name: "check_ancestry",
  description: t.check_ancestry!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().min(1).max(300).describe(p("check_ancestry", "repo")),
    ancestor: z.string().max(300).describe(p("check_ancestry", "ancestor")),
    descendant: z.string().max(300).describe(p("check_ancestry", "descendant")),
  }).strict(),
  async execute(a, ctx) {
    const revs = [oneRevision(a.ancestor), oneRevision(a.descendant)];
    const r = await repoOrThrow(ctx, a.repo);
    const git = timedGit(r.path, { ...GIT_LIMITS, ...ctx.deps.gitLimits }, `checking "${a.ancestor}" against "${a.descendant}" in "${a.repo}".`);
    const side: { revision: string; commit?: string }[] = [], unresolved: { revision: string; reason: string }[] = [];
    for (const revision of revs) {
      const x = await resolveCommit(git, revision);
      if ("run" in x) throw new Error(`git could not read revision "${revision}" in "${a.repo}".`);
      if ("sha" in x) side.push({ revision, commit: x.sha }); else { side.push({ revision }); unresolved.push({ revision, reason: x.unresolved }); }
    }
    const answer = (result: "yes" | "no" | "unresolved", explanation: string) => JSON.stringify({ repo: a.repo, ancestor: side[0], descendant: side[1], result, explanation, ...(unresolved.length ? { unresolved } : {}) });
    if (unresolved.length) return { output: answer("unresolved", "No answer: a revision could not be resolved, so nothing was compared.") };
    const g = await git(["merge-base", "--is-ancestor", side[0]!.commit!, side[1]!.commit!], 200);
    if (g.code === 0) return { output: answer("yes", side[0]!.commit === side[1]!.commit ? "Both revisions are the same commit; a commit counts as its own ancestor." : "The ancestor is reachable from the descendant.") };
    if (g.code === 1) return { output: answer("no", "The ancestor is not reachable from the descendant (the histories diverged or are unrelated).") };
    throw new Error(`git could not check whether "${a.ancestor}" is an ancestor of "${a.descendant}" in "${a.repo}".`);
  },
});

// ---- get_range_history ----

const RANGE_COUNT = 20, RANGE_MAX = 50, RANGE_DIFF_BYTES = 2000, COMMIT_FILES = 100, HUNKS_PER_FILE = 50, DECL_CHARS = 200;

/** A file path for `git log -L`: from the repository root, and without the `:` that the -L argument is split at. */
function rangePath(f: string) {
  if (!isPathValid(f) || /^\.?\//.test(f) || f.endsWith("/") || f.includes(":")) throw new Error(`File "${f}" is not accepted: give the path from the repository root, with no "..", no leading "./" or "/", no trailing "/" and no ":".`);
  return f;
}

const getRangeHistory = define({
  name: "get_range_history",
  description: t.get_range_history!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().min(1).max(300).describe(p("get_range_history", "repo")),
    file: z.string().min(1).max(500).describe(p("get_range_history", "file")).optional(),
    revision: z.string().max(300).describe(p("get_range_history", "revision")).optional(),
    startLine: z.number().int().min(1).describe(p("get_range_history", "startLine")).optional(),
    endLine: z.number().int().min(1).describe(p("get_range_history", "endLine")).optional(),
    function: term.describe(p("get_range_history", "function")).optional(),
    commit: z.string().max(300).describe(p("get_range_history", "commit")).optional(),
    count: z.number().int().min(1).max(RANGE_MAX).describe(p("get_range_history", "count")).optional().default(RANGE_COUNT),
  }).strict(),
  async execute(a, ctx) {
    const count = a.count ?? RANGE_COUNT;
    if (a.file !== undefined) rangePath(a.file);
    if (a.commit !== undefined && (a.revision !== undefined || a.function !== undefined || a.startLine !== undefined || a.endLine !== undefined)) throw new Error("With `commit`, give no revision, function or line range.");
    if (a.function?.includes(":")) throw new Error('A function name cannot contain ":" (git splits the -L argument there); give the part after the last ":".');
    if (a.commit === undefined) {
      if (a.file === undefined) throw new Error("Give `file` (the path from the repository root).");
      if ((a.startLine === undefined) !== (a.endLine === undefined)) throw new Error("Give both startLine and endLine.");
      if ((a.function === undefined) === (a.startLine === undefined)) throw new Error("Give either a line range (startLine and endLine) or a function, not both and not neither.");
      if (a.startLine! > a.endLine!) throw new Error(`startLine (${a.startLine}) is after the end line (${a.endLine}).`);
    }
    const rev = oneRevision(a.commit ?? a.revision ?? "HEAD");
    const r = await repoOrThrow(ctx, a.repo);
    const lim = { ...GIT_LIMITS, ...ctx.deps.gitLimits };
    const git = timedGit(r.path, lim, `reading "${rev}" in "${a.repo}"; try a smaller range or fewer commits.`);
    const x = await resolveCommit(git, rev);
    if ("unresolved" in x) throw new Error(`Revision "${rev}" not found in repository "${a.repo}".`);
    if ("run" in x) throw new Error(`git could not read revision "${rev}" in "${a.repo}".`);
    const gaps: string[] = [], short = x.sha.slice(0, 10);
    const revision = { revision: rev, commit: x.sha };

    if (a.commit !== undefined) {
      const g = await git(["-c", "core.quotePath=false", "--literal-pathspecs", "show", "--format=%x01%P", "-p", "-U0", "-M", "--first-parent", "--no-color", "--end-of-options", x.sha, ...(a.file ? ["--", a.file] : [])], lim.repoBytes, true);
      const lines = g.stdout.slice(1).split("\n");
      if (g.limit) lines.pop(); // a cut run ends inside a line
      const gap = runGap(a.repo, g, lim, "its declarations");
      if (gap) gaps.push(gap);
      const files = declarations(lines.slice(1));
      const merge = lines[0]!.includes(" ");
      const summary = !files.length && !gap ? `Commit ${short} has no changes${a.file ? ` in ${a.file}` : ""}.` : `Declarations git prints at the top of the hunks of commit ${short}: its guess at the enclosing declaration (null when none precedes), not a parsed symbol.${merge ? " This is a merge commit: it is compared with its first parent." : ""}`;
      return { output: listAnswer("files", files.slice(0, COMMIT_FILES), files.length, { repo: a.repo, commit: revision, file: a.file }, 1, gaps, summary) };
    }

    // History mode: read the file at the revision first, so a missing path, a binary file or a range that is not there is said in words.
    const file = a.file!, filters = { repo: a.repo, file, revision, count } as Record<string, unknown>;
    const empty = (summary: string) => ({ output: listAnswer("commits", [], 0, filters, 1, gaps, summary) });
    const blob = await git(["cat-file", "blob", `${x.sha}:${file}`]);
    if (blob.limit === "bytes") throw new Error(`"${file}" is larger than ${lim.repoBytes} bytes at ${rev}; its lines cannot be checked.`);
    if (blob.code !== 0) {
      if (/does not exist|bad file|Not a valid object name|not a blob/.test(blob.stderr)) return empty(`"${file}" is not a file at ${rev} (${short}). It may not exist yet, or was renamed or deleted; try an older or newer revision.`);
      throw new Error(`git could not read "${file}" at "${rev}" in "${a.repo}".`);
    }
    if (blob.stdout.slice(0, 8000).includes("\0")) return empty(`"${file}" is a binary file; it has no line history.`);
    const lines = blob.stdout.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const notes: string[] = [];
    let arg: string;
    if (a.function !== undefined) {
      const hits = lines.flatMap((l, i) => (l.includes(a.function!) ? [i + 1] : []));
      if (!hits.length) return empty(`No line of "${file}" at ${rev} (${short}) contains "${a.function}".`);
      // git reads the name as a basic regular expression: only these characters are special in it
      arg = `-L:${a.function.replace(/[\\.[*^$]/g, "\\$&")}:${file}`;
      filters.target = { function: a.function, matchingLines: hits.slice(0, 20) };
      notes.push(hits.length > 1 ? `The name appears on lines ${hits.slice(0, 20).join(", ")}${hits.length > 20 ? " and more" : ""}; git follows the declaration at the first, line ${hits[0]}.` : `The declaration is at line ${hits[0]}.`);
    } else {
      const end = Math.min(a.endLine!, lines.length);
      if (a.startLine! > lines.length) return empty(`"${file}" has only ${lines.length} lines at ${rev} (${short}); lines ${a.startLine}-${a.endLine} do not exist there.`);
      arg = `-L${a.startLine},${end}:${file}`;
      filters.target = { startLine: a.startLine, endLine: end };
      if (end < a.endLine!) notes.push(`The range ends at line ${end} because the file has ${lines.length} lines.`);
    }
    const g = await git(["-c", "core.quotePath=false", "log", DIFF_FORMAT, `--max-count=${count + 1}`, arg, "--end-of-options", x.sha], lim.repoBytes, true);
    const recs = g.stdout.split(/^\x01/m).slice(1);
    if (g.limit) recs.pop(); // a cut run ends inside a record
    const gap = runGap(a.repo, g, lim, "its history");
    if (gap) gaps.push(gap);
    if (recs.length > count) gaps.push(`older commits exist beyond the ${count} shown; raise count (at most ${RANGE_MAX}) or give an older revision`);
    const commits = recs.slice(0, count).map((rec) => {
      const lines = rec.split("\n"), [hash = "", ts = "0", author = "", ...subject] = lines[0]!.split("\x1f");
      const plus = lines.find((l) => l.startsWith("+++ ")), minus = lines.find((l) => l.startsWith("--- "));
      const at = lines.findIndex((l) => l.startsWith("@@")), diff = at < 0 ? "" : lines.slice(at).join("\n").trimEnd();
      const cut = cutMiddle(diff, RANGE_DIFF_BYTES);
      return {
        hash, date: new Date(Number(ts) * 1000).toISOString(), author, subject: cutChars(subject.join("\x1f"), SUBJECT_CHARS),
        path: (plus && pathOf(plus.slice(4), "b/")) || (minus && pathOf(minus.slice(4), "a/")) || file, diff: cut, ...(cut !== diff ? { diffCut: true } : {}),
      };
    });
    const what = a.function !== undefined ? `the declaration of "${a.function}"` : `lines ${a.startLine}-${Math.min(a.endLine!, lines.length)}`;
    const summary = `History of ${what} in ${file} as it is at ${rev} (${short}), newest first. Renames and moves are followed: each commit's path is the file's name at that commit. ${notes.join(" ")}`.trim();
    return { output: listAnswer("commits", commits, commits.length, filters, 1, gaps, summary) };
  },
});

/** The files of a `-U0` diff with, for each hunk, the declaration text git prints after the hunk's `@@` header. */
function declarations(lines: string[]) {
  const files: { file: string; binary?: true; hunks: number; declarations: { declaration: string | null; oldStart: number; newStart: number }[] }[] = [];
  let from = "", cur: (typeof files)[number] | undefined, header = false;
  for (const l of lines) {
    if (l.startsWith("diff --git ")) { header = true; from = ""; cur = undefined; continue; }
    const bin = header ? /^Binary files (.*) and (.*) differ$/.exec(l) : null;
    if (bin) { files.push({ file: pathOf(bin[2]!, "b/") || pathOf(bin[1]!, "a/"), binary: true, hunks: 0, declarations: [] }); continue; }
    if (header && l.startsWith("--- ")) from = pathOf(l.slice(4), "a/");
    else if (header && l.startsWith("+++ ")) files.push(cur = { file: pathOf(l.slice(4), "b/") || from, hunks: 0, declarations: [] });
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(l);
    if (h && cur) {
      header = false;
      cur.hunks++;
      if (cur.declarations.length < HUNKS_PER_FILE) cur.declarations.push({ declaration: h[3]!.trim() ? cutChars(h[3]!.trim(), DECL_CHARS) : null, oldStart: Number(h[1]), newStart: Number(h[2]) });
    }
  }
  return files;
}

// ---- registry ----

export const gitToolDefinitions = { search_commits: searchCommits, search_diffs: searchDiffs, compare_revisions: compareRevisions, list_refs: listRefs, check_ancestry: checkAncestry, get_range_history: getRangeHistory } as const;

/** In MCP registration order, after the pull request history tools. */
export const gitToolNames = Object.keys(gitToolDefinitions) as (keyof typeof gitToolDefinitions)[];

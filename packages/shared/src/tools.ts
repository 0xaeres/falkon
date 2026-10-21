import { z } from "zod";
import { toolJsonSchema } from "./toolJsonSchema";
import escapeStringRegexp from "escape-string-regexp";
import globToRegExp from "glob-to-regexp";
import parseDiff from "parse-diff";
import { simpleGit } from "simple-git";
import { qRepo, type Q } from "./ir";
import { searchIR, type SearchResponse } from "./zoekt";
import type { Scope } from "./access";
import text from "./toolText.json" with { type: "json" };

/**
 * The tools behind MCP and the Ask agent. Names, input schemas and output text are pinned by
 * tests/contract; descriptions live in toolText.json. Each returns `{ output }`, the text an agent sees.
 */

/** A repository row as the tools need it. */
export interface ToolRepo {
  name: string;
  displayName: string | null;
  codeHostType: string;
  webUrl: string | null;
  defaultBranch: string | null;
  isFork: boolean;
  isArchived: boolean;
  pushedAt: Date | null;
  indexedAt: Date | null;
  /** Refs the last index covered (metadata.indexedRevisions). */
  indexedRevisions: string[];
  /** Where its git data lives (a bare repo or a work tree). */
  path: string;
}

export interface ToolDeps {
  getRepo(name: string): Promise<ToolRepo | undefined>;
  /** Every code repo whose name contains `query` (case-insensitive), in the requested order. The tool applies scope and paging. */
  listRepos(o: { query?: string; sort: "name" | "pushed"; direction: "asc" | "desc" }): Promise<ToolRepo[]>;
  /** The web app's public base URL (the AUTH_URL setting). */
  baseUrl: string;
}

export interface ToolContext {
  deps: ToolDeps;
  scope: Scope;
  /** Repos an Ask chat is limited to; search tools default to them when no `repo` is given. */
  selectedRepos?: string[];
}

/** A file a tool result points at; the Ask agent resolves @file: references against these. */
export interface ToolSource {
  type: "file";
  repo: string;
  path: string;
  name: string;
  revision: string;
}

export interface ToolResult {
  output: string;
  sources?: ToolSource[];
}

interface ToolDefinition<S extends z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: z.ZodObject<S>;
  isReadOnly: boolean;
  isIdempotent: boolean;
  execute(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<ToolResult>;
}

const t = text as Record<string, { description: string; params: Record<string, string> }>;
const p = (tool: string, param: string) => t[tool]!.params[param]!;
const define = <S extends z.ZodRawShape>(d: ToolDefinition<S>) => d;

// ---- service errors ----

const notFound = (repo: string) => new Error(`Repository "${repo}" not found.`);
const fileNotFound = (path: string, repo: string) => new Error(`File "${path}" not found in repository "${repo}"`);
const invalidGitRef = (ref: string) => new Error(`Invalid git reference: "${ref}". Git refs cannot start with '-'.`);
const unresolvedGitRef = (ref: string) => new Error(`Git reference "${ref}" could not be resolved.`);
const unexpected = (m: string) => new Error(`Unexpected error: ${m}`);
const isGitRefValid = (ref: string) => !ref.startsWith("-");
const isPathValid = (path: string) => !(path.split("/").some((s) => s === "..") || path.includes("\0"));

/** Repo by name, invisible (same error as missing) when the caller's scope excludes it. */
async function repoOrThrow(ctx: ToolContext, name: string) {
  const r = ctx.scope.allows(name) ? await ctx.deps.getRepo(name) : undefined;
  if (!r) throw notFound(name);
  return r;
}

const git = (r: ToolRepo) => simpleGit().cwd(r.path);
const truncateLine = (l: string) => (l.length > 2000 ? l.substring(0, 2000) + "... (line truncated to 2000 chars)" : l);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Code host page for a file at a branch; undefined for hosts without one (generic git). */
export function codeHostFileUrl(webUrl: string | null, codeHostType: string, branch: string, filePath: string): string | undefined {
  if (!webUrl) return undefined;
  const b = branch.replace(/^refs\/(heads|tags)\//, "");
  switch (codeHostType) {
    case "github":
      return `${webUrl}/blob/${b}/${filePath}`;
    case "gitlab":
      return `${webUrl}/-/blob/${b}/${filePath}`;
    case "gitea":
      return `${webUrl}/src/branch/${b}/${filePath}`;
    case "azuredevops":
      return `${webUrl}?path=${filePath}&version=${b}`;
    case "bitbucketCloud":
      return `${webUrl}/src/${b}/${filePath}`;
    case "bitbucketServer":
      return `${webUrl}/browse/${filePath}?at=${b}`;
    case "gerrit":
      return `${webUrl}/+/${b}/${filePath}`;
  }
  return undefined;
}

/** The web UI path for a repo tree/blob. */
export const browsePath = (repo: string, path: string, type: "tree" | "blob", revision?: string) =>
  `/browse/${repo}${revision ? `@${revision}` : ""}/-/${type}/${encodeURIComponent(path.replace(/^\/+/, ""))}`;

// ---- search-backed tools ----

const re = (regexp: string, fileName: boolean): Q => ({ regexp: { regexp, case_sensitive: true, file_name: fileName, content: !fileName } });
/** Glob to an unanchored-start regex (glob-to-regexp, extended + globstar). */
const globRe = (glob: string) => globToRegExp(glob, { extended: true, globstar: true }).source.replace(/^\^/, "");
const escapePath = (path: string) => path.replace(/[\\.^$|?*+()[\]{}]/g, "\\$&");
const and = (nodes: (Q | undefined)[]): Q => {
  const n = nodes.filter((x): x is Q => x !== undefined);
  return n.length === 1 ? n[0]! : { and: { children: n } };
};
/** `repo`, else the chat's selected repos, as a repo set; nothing when neither is given. */
const repoSet = (repo: string | undefined, ctx: ToolContext): Q | undefined => {
  const names = repo ? [repo] : ctx.selectedRepos;
  return names?.length ? { repo_set: { set: Object.fromEntries(names.map((n) => [n, true])) } } : undefined;
};
const fileSource = (repo: string, path: string, revision: string): ToolSource => ({ type: "file", repo, path, name: path.split("/").pop() ?? path, revision });
const branch = (ref?: string): Q | undefined => (ref ? { branch: { pattern: ref === "*" ? "" : ref, exact: false } } : undefined);

/** Runs a search for a tool: the caller's scope narrows the query and filters the hits. */
async function toolSearch(ctx: ToolContext, q: Q, matches: number): Promise<SearchResponse> {
  const r = await searchIR(q, { matches, contextLines: 0 }, ctx.scope.repoFilter ? [qRepo(ctx.scope.repoFilter)] : []);
  const files = r.files.filter((f) => ctx.scope.allows(f.repo));
  return files.length === r.files.length ? r : { ...r, files, fileCount: files.length, matchCount: files.reduce((n, f) => n + f.occurrences, 0) };
}
/** Match count: content ranges plus file-name ranges. */
const actualMatches = (r: SearchResponse) => r.files.reduce((n, f) => n + f.chunks.reduce((m, c) => m + c.matchRanges.length, 0) + f.fileNameRanges.length, 0);

const TRUNCATED_GREP = "(Output was cut short: narrow the path or pattern, name a repo, or raise the limit.)";
const TRUNCATED_GLOB = "(Output was cut short: narrow the pattern, name a repo, or raise the limit.)";

const grep = define({
  name: "grep",
  description: t.grep!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    pattern: z.string().describe(p("grep", "pattern")),
    path: z.string().describe(p("grep", "path")).optional(),
    include: z.string().describe(p("grep", "include")).optional(),
    repo: z.string().describe(p("grep", "repo")).optional(),
    ref: z.string().describe(p("grep", "ref")).optional(),
    limit: z.number().describe(p("grep", "limit")).optional(),
    groupByRepo: z.boolean().optional().describe(p("grep", "groupByRepo")),
  }),
  async execute({ pattern, path, include, repo, ref, limit, groupByRepo = false }, ctx) {
    const q = and([re(pattern, false), path ? re(escapePath(path), true) : undefined, include ? re(globRe(include), true) : undefined, repoSet(repo, ctx), branch(ref)]);
    const r = await toolSearch(ctx, q, limit ?? (groupByRepo ? 10_000 : 100));
    if (repo) await repoOrThrow(ctx, repo);
    if (r.files.length === 0) return { output: "No files found" };
    if (groupByRepo) {
      const by = new Map<string, { matches: number; files: number }>();
      for (const f of r.files) {
        const m = f.chunks.reduce((n, c) => n + c.matchRanges.length, 0);
        const cur = by.get(f.repo) ?? { matches: 0, files: 0 };
        by.set(f.repo, { matches: cur.matches + m, files: cur.files + 1 });
      }
      const out = [`Found matches in ${by.size} ${plural(by.size, "repository", "repositories")}:`];
      for (const [name, { matches, files }] of by) out.push(`  ${name}: ${matches} ${plural(matches, "match", "matches")} in ${files} ${plural(files, "file")}`);
      if (!r.isSearchExhaustive) out.push("", TRUNCATED_GREP);
      return { output: out.join("\n") };
    }
    const n = actualMatches(r);
    const out = [`Found ${n} match${n !== 1 ? "es" : ""} in ${r.files.length} file${r.files.length !== 1 ? "s" : ""}`];
    for (const f of r.files) {
      out.push("", `[${f.repo}] ${f.path}:`);
      for (const c of f.chunks) {
        c.content.split("\n").forEach((line, i) => {
          if (!line.trim()) return;
          out.push(`  ${c.contentStart.lineNumber + i}: ${truncateLine(line)}`);
        });
      }
    }
    if (!r.isSearchExhaustive) out.push("", TRUNCATED_GREP);
    return { output: out.join("\n"), sources: r.files.map((f) => fileSource(f.repo, f.path, ref ?? "HEAD")) };
  },
});

const glob = define({
  name: "glob",
  description: t.glob!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    pattern: z.string().describe(p("glob", "pattern")),
    path: z.string().describe(p("glob", "path")).optional(),
    repo: z.string().describe(p("glob", "repo")).optional(),
    ref: z.string().describe(p("glob", "ref")).optional(),
    limit: z.number().describe(p("glob", "limit")).optional(),
  }),
  async execute({ pattern, path, repo, ref, limit }, ctx) {
    const q = and([re(globRe(pattern), true), path ? re(escapePath(path), true) : undefined, repoSet(repo, ctx), branch(ref)]);
    const r = await toolSearch(ctx, q, limit ?? 100);
    if (repo) await repoOrThrow(ctx, repo);
    if (r.files.length === 0) return { output: "No files found" };
    const by = new Map<string, string[]>();
    for (const f of r.files) by.set(f.repo, [...(by.get(f.repo) ?? []), f.path]);
    const out = [`Found ${r.files.length} file${r.files.length !== 1 ? "s" : ""} matching "${pattern}":`];
    for (const [name, paths] of by) {
      out.push("", `[${name}]`);
      for (const fp of paths) out.push(`  ${fp}`);
    }
    if (!r.isSearchExhaustive) out.push("", TRUNCATED_GLOB);
    return { output: out.join("\n"), sources: r.files.map((f) => fileSource(f.repo, f.path, ref ?? "HEAD")) };
  },
});

/** Search-based code navigation: `\bNAME\b` (references) or a symbol match (definitions) at HEAD in one repo. */
async function symbolSearch(ctx: ToolContext, symbol: string, repo: string, kind: "definitions" | "references") {
  const content: Q = { regexp: { regexp: `\\b${symbol}\\b`, case_sensitive: true, file_name: false, content: true } };
  const q: Q = {
    and: {
      children: [kind === "definitions" ? { symbol: { expr: content } } : content, { branch: { pattern: "HEAD", exact: true } }, { repo: { regexp: `^${escapeStringRegexp(repo)}$` } }],
    },
  };
  const r = await toolSearch(ctx, q, 1000);
  const files = r.files
    .map((f) => ({ fileName: f.path, repository: f.repo, matches: f.chunks.flatMap((c) => c.matchRanges.map((range) => ({ lineContent: c.content, range }))) }))
    .filter((f) => f.matches.length > 0);
  await repoOrThrow(ctx, repo);
  const one = kind === "definitions" ? "definition" : "reference";
  if (files.length === 0) return { output: `No ${one}s found` };
  const n = actualMatches(r);
  const out = [`Found ${n} ${plural(n, one)} in ${files.length} ${plural(files.length, "file")}`];
  for (const f of files) {
    out.push("", `[${f.repository}] ${f.fileName}:`);
    for (const m of f.matches) out.push(`  ${m.range.start.lineNumber}: ${truncateLine(m.lineContent.trimEnd())}`);
  }
  return { output: out.join("\n"), sources: files.map((f) => fileSource(f.repository, f.fileName, "HEAD")) };
}

const findSymbolDefinitions = define({
  name: "find_symbol_definitions",
  description: t.find_symbol_definitions!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({ symbol: z.string().describe(p("find_symbol_definitions", "symbol")), repo: z.string().describe(p("find_symbol_definitions", "repo")) }),
  execute: ({ symbol, repo }, ctx) => symbolSearch(ctx, symbol, repo, "definitions"),
});

const findSymbolReferences = define({
  name: "find_symbol_references",
  description: t.find_symbol_references!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({ symbol: z.string().describe(p("find_symbol_references", "symbol")), repo: z.string().describe(p("find_symbol_references", "repo")) }),
  execute: ({ symbol, repo }, ctx) => symbolSearch(ctx, symbol, repo, "references"),
});

// ---- git-backed tools ----

const READ_FILE_MAX_LINES = 500;
const READ_FILE_MAX_BYTES = 5120;

const readFile = define({
  name: "read_file",
  description: t.read_file!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    path: z.string().describe(p("read_file", "path")),
    repo: z.string().describe(p("read_file", "repo")),
    ref: z.string().describe(p("read_file", "ref")).optional().default("HEAD"),
    offset: z.number().int().positive().optional().describe(p("read_file", "offset")),
    limit: z.number().int().positive().optional().describe(p("read_file", "limit")),
  }),
  async execute({ path, repo, ref = "HEAD", offset, limit }, ctx) {
    const r = await repoOrThrow(ctx, repo);
    if (!isPathValid(path)) throw fileNotFound(path, repo);
    if (!isGitRefValid(ref)) throw invalidGitRef(ref);
    let source: string;
    try {
      source = await git(r).raw(["show", `${ref}:${path}`]);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("does not exist") || m.includes("fatal: path")) throw fileNotFound(path, repo);
      if (m.includes("unknown revision") || m.includes("bad revision") || m.includes("invalid object name")) throw unresolvedGitRef(ref);
      throw unexpected(m);
    }
    const lines = source.split("\n");
    const start = (offset ?? 1) - 1;
    const end = start + Math.min(limit ?? READ_FILE_MAX_LINES, READ_FILE_MAX_LINES);
    let bytes = 0;
    let capped = false;
    const shown: string[] = [];
    for (const raw of lines.slice(start, end)) {
      const line = truncateLine(raw);
      const size = Buffer.byteLength(line, "utf-8") + (shown.length > 0 ? 1 : 0);
      if (bytes + size > READ_FILE_MAX_BYTES) {
        capped = true;
        break;
      }
      shown.push(line);
      bytes += size;
    }
    const more = end < lines.length;
    const first = offset ?? 1;
    const last = first + shown.length - 1;
    // The code host link is printed as-is, so a host without one shows "undefined".
    let out = `<repo>${r.name}</repo>\n<path>${path}</path>\n<url>${codeHostFileUrl(r.webUrl, r.codeHostType, ref, path)}</url>\n<content>\n`;
    out += shown.map((l, i) => `${first + i}: ${l}`).join("\n");
    if (capped) out += `\n\n(Output capped at 5KB. Showing lines ${first}-${last} of ${lines.length}. Use offset=${last + 1} to continue.)`;
    else if (more) out += `\n\n(Showing lines ${first}-${last} of ${lines.length}. Use offset=${last + 1} to continue.)`;
    else out += `\n\n(End of file - ${lines.length} lines total)`;
    return { output: out + "\n</content>", sources: [fileSource(r.name, path, ref)] };
  },
});

interface TreeNode {
  name: string;
  path: string;
  type: string;
  children: TreeNode[];
}
const compareTreeItems = (a: TreeNode, b: TreeNode) =>
  a.type !== b.type ? (a.type === "tree" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Nests ls-tree output into a tree, directories first then by name. */
function buildFileTree(entries: { type: string; path: string }[]): TreeNode {
  const root: TreeNode = { name: "root", path: "", type: "tree", children: [] };
  for (const e of entries) {
    const parts = e.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const type = i === parts.length - 1 ? e.type : "tree";
      let child = node.children.find((c) => c.name === part && c.type === type);
      if (!child) node.children.push((child = { name: part, path: e.path, type, children: [] }));
      node = child;
    });
  }
  const sort = (n: TreeNode): TreeNode => (n.type === "blob" ? n : { ...n, children: n.children.map(sort).sort(compareTreeItems) });
  return sort(root);
}

const normalizeDir = (path: string) => {
  let s = path.endsWith("/") ? path : `${path}/`;
  if (s.startsWith("/")) s = s.slice(1);
  return s;
};

async function getTree(r: ToolRepo, revision: string, paths: string[]): Promise<TreeNode> {
  if (!isGitRefValid(revision)) throw invalidGitRef(revision);
  if (!paths.every(isPathValid)) throw new Error("Not found");
  let out: string;
  try {
    out = await git(r).raw(["-c", "core.quotePath=false", "ls-tree", revision, "--format=%(objecttype),%(path)", "-t", "--", ".", ...paths.map(normalizeDir)]);
  } catch {
    throw unexpected("git ls-tree command failed.");
  }
  const entries = out
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const i = l.indexOf(",");
      if (i === -1) throw new Error(`Unexpected ls-tree output: ${l}`);
      return { type: l.substring(0, i), path: l.substring(i + 1) };
    });
  return buildFileTree(entries);
}

const LIST_TREE_DEFAULT_DEPTH = 1;
const LIST_TREE_DEFAULT_MAX = 1000;

const listTree = define({
  name: "list_tree",
  description: t.list_tree!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().describe(p("list_tree", "repo")),
    path: z.string().describe(p("list_tree", "path")).optional().default(""),
    ref: z.string().describe(p("list_tree", "ref")).optional().default("HEAD"),
    depth: z.number().int().positive().max(10).describe(p("list_tree", "depth")).optional().default(LIST_TREE_DEFAULT_DEPTH),
    includeFiles: z.boolean().describe(p("list_tree", "includeFiles")).optional().default(true),
    includeDirectories: z.boolean().describe(p("list_tree", "includeDirectories")).optional().default(true),
    maxEntries: z.number().int().positive().max(10_000).describe(p("list_tree", "maxEntries")).optional().default(LIST_TREE_DEFAULT_MAX),
  }),
  async execute({ repo, path = "", ref = "HEAD", depth = 1, includeFiles = true, includeDirectories = true, maxEntries = 1000 }, ctx) {
    const base = path.replace(/^\/+/, "").replace(/\/+$/, "");
    const maxDepth = Math.min(depth, 10);
    const max = Math.min(maxEntries, 10_000);
    const r = await repoOrThrow(ctx, repo);
    if (!includeFiles && !includeDirectories) return { output: "No entries found" };
    const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

    type Entry = { type: string; path: string; name: string; parentPath: string; depth: number };
    const queue = [{ path: base, depth: 0 }];
    const queued = new Set([base]);
    const seen = new Set<string>();
    const entries: Entry[] = [];
    let truncated = false;
    // Breadth-first, one ls-tree per level.
    while (queue.length > 0 && !truncated) {
      const level = queue[0]!.depth;
      const dirs: string[] = [];
      while (queue.length > 0 && queue[0]!.depth === level) dirs.push(queue.shift()!.path);
      const tree = await getTree(r, ref, dirs.filter(Boolean));
      const index = new Map<string, TreeNode>();
      const walk = (n: TreeNode, at: string) => {
        index.set(at, n);
        for (const c of n.children) walk(c, join(at, c.name));
      };
      walk(tree, "");
      for (const dir of dirs) {
        const node = dir === "" ? tree : index.get(dir);
        if (!node || node.type !== "tree") continue;
        for (const c of node.children) {
          if (c.type !== "tree" && c.type !== "blob") continue;
          const childPath = join(dir, c.name);
          const childDepth = level + 1;
          if (c.type === "tree" && childDepth < maxDepth && !queued.has(childPath)) {
            queue.push({ path: childPath, depth: childDepth });
            queued.add(childPath);
          }
          if ((c.type === "blob" && !includeFiles) || (c.type === "tree" && !includeDirectories)) continue;
          const key = `${c.type}:${childPath}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (entries.length >= max) {
            truncated = true;
            break;
          }
          entries.push({ type: c.type, path: childPath, name: c.name, parentPath: dir, depth: childDepth });
        }
        if (truncated) break;
      }
    }
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const sorted = [...entries].sort((a, b) => {
      const byParent = collator.compare(a.parentPath, b.parentPath);
      if (byParent !== 0) return byParent;
      if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
      return collator.compare(a.name, b.name) || collator.compare(a.path, b.path);
    });
    const out = [base || "/"];
    const byParent = new Map<string, Entry[]>();
    for (const e of sorted) byParent.set(e.parentPath, [...(byParent.get(e.parentPath) ?? []), e]);
    const print = (dir: string) => {
      for (const e of byParent.get(dir) ?? []) {
        out.push(`${"  ".repeat(e.depth)}${e.type === "tree" ? `${e.name}/` : e.name}`);
        if (e.type === "tree") print(e.path);
      }
    };
    print(base);
    if (sorted.length === 0) out.push("  (no entries found)");
    if (truncated) out.push("", `(truncated — showing first ${max} entries)`);
    return { output: out.join("\n"), sources: sorted.filter((e) => e.type === "blob").map((e) => ({ type: "file" as const, repo, path: e.path, name: e.name, revision: ref })) };
  },
});

const listBranches = define({
  name: "list_branches",
  description: t.list_branches!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().describe(p("list_branches", "repo")),
    query: z.string().describe(p("list_branches", "query")).optional(),
    page: z.number().int().positive().describe(p("list_branches", "page")).optional().default(1),
    perPage: z.number().int().positive().max(100).describe(p("list_branches", "perPage")).optional().default(50),
  }),
  async execute({ repo, query, page = 1, perPage = 50 }, ctx) {
    const r = await repoOrThrow(ctx, repo).catch(() => {
      throw new Error("Failed to list branches.");
    });
    let raw: string;
    try {
      raw = await git(r).raw(["for-each-ref", "--sort=-committerdate", "--format=%(refname:lstrip=2)%09%(objectname)%09%(committerdate:iso-strict)", "refs/heads"]);
    } catch {
      throw new Error("Failed to list branches.");
    }
    const def = r.defaultBranch?.replace(/^refs\/heads\//, "");
    const indexed = r.indexedRevisions;
    const all = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, commit, committedAt] = l.split("\t") as [string, string, string];
        const isDefault = name === def;
        return { name, commit, committedAt, isDefault, isIndexed: indexed.includes(`refs/heads/${name}`) || indexed.includes(name) || (isDefault && indexed.includes("HEAD")) };
      });
    const matching = query ? all.filter((b) => b.name.toLowerCase().includes(query.toLowerCase())) : all;
    const start = (page - 1) * perPage;
    return {
      output: JSON.stringify({ repo: r.name, defaultBranch: def, indexedAt: r.indexedAt?.toISOString(), totalCount: matching.length, branches: matching.slice(start, start + perPage) }),
    };
  },
});

/** Relative dates ("3 days ago", "yesterday", "last week") to ISO; anything else is passed through. */
function parseRelativeDate(s?: string): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const v = s.toLowerCase().trim();
  if (v === "yesterday") {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return y.toISOString();
  }
  const ago = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(v);
  if (ago) {
    const n = Number.parseInt(ago[1]!);
    const x = new Date();
    switch (ago[2]!.toLowerCase()) {
      case "second": x.setSeconds(x.getSeconds() - n); break;
      case "minute": x.setMinutes(x.getMinutes() - n); break;
      case "hour": x.setHours(x.getHours() - n); break;
      case "day": x.setDate(x.getDate() - n); break;
      case "week": x.setDate(x.getDate() - 7 * n); break;
      case "month": x.setMonth(x.getMonth() - n); break;
      case "year": x.setFullYear(x.getFullYear() - n); break;
    }
    return x.toISOString();
  }
  const last = /^last\s+(week|month|year)$/i.exec(v);
  if (last) {
    const x = new Date();
    if (last[1] === "week") x.setDate(x.getDate() - 7);
    else if (last[1] === "month") x.setMonth(x.getMonth() - 1);
    else x.setFullYear(x.getFullYear() - 1);
    return x.toISOString();
  }
  return s;
}
/** Forms git understands natively go through untouched; others are resolved first. */
function toGitDate(s?: string): string | undefined {
  if (!s) return undefined;
  for (const r of [/^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i, /^yesterday$/i, /^last\s+(week|month|year)$/i, /^\d{4}-\d{2}-\d{2}$/, /^\d{4}-\d{2}-\d{2}T/]) if (r.test(s)) return s;
  return parseRelativeDate(s);
}
function validateDateRange(since?: string, until?: string): string | null {
  if (!since || !until) return null;
  const a = parseRelativeDate(since);
  const b = parseRelativeDate(until);
  if (!a || !b) return null;
  const x = new Date(a);
  const y = new Date(b);
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return null;
  return x > y ? `Invalid date range: 'since' (${since}) must be before 'until' (${until})` : null;
}

const listCommits = define({
  name: "list_commits",
  description: t.list_commits!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().describe(p("list_commits", "repo")),
    query: z.string().describe(p("list_commits", "query")).optional(),
    since: z.string().describe(p("list_commits", "since")).optional(),
    until: z.string().describe(p("list_commits", "until")).optional(),
    author: z.string().describe(p("list_commits", "author")).optional(),
    ref: z.string().describe(p("list_commits", "ref")).optional(),
    path: z.string().describe(p("list_commits", "path")).optional(),
    page: z.number().int().positive().describe(p("list_commits", "page")).optional().default(1),
    perPage: z.number().int().positive().max(100).describe(p("list_commits", "perPage")).optional().default(50),
  }),
  async execute({ repo, query, since, until, author, ref = "HEAD", path, page = 1, perPage = 50 }, ctx) {
    const r = await repoOrThrow(ctx, repo);
    if (!isGitRefValid(ref)) throw invalidGitRef(ref);
    const bad = validateDateRange(since, until);
    if (bad) throw unexpected(bad);
    const s = toGitDate(since);
    const u = toGitDate(until);
    const filters: Record<string, string | null> = {
      ...(s ? { "--since": s } : {}),
      ...(u ? { "--until": u } : {}),
      ...(author ? { "--author": author, "--regexp-ignore-case": null } : {}),
      ...(query ? { "--grep": query, "--regexp-ignore-case": null } : {}),
    };
    const flag = ([k, v]: [string, string | null]) => (v !== null ? `${k}=${v}` : k);
    const skip = (page - 1) * perPage;
    const args = [`--max-count=${perPage}`, ...(skip > 0 ? [`--skip=${skip}`] : []), ...Object.entries(filters).map(flag), ref, ...(path ? ["--", path] : [])];
    const count = ["rev-list", "--count", ref, ...Object.entries(filters).map(flag), ...(path ? ["--", path] : [])];
    try {
      const g = git(r);
      const log = await g.log(args);
      const totalCount = Number.parseInt((await g.raw(count)).trim(), 10);
      return {
        output: JSON.stringify({
          commits: log.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message, refs: c.refs, body: c.body, authorName: c.author_name, authorEmail: c.author_email })),
          totalCount,
        }),
      };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("not a git repository")) throw unexpected(`Invalid git repository at ${r.path}. The directory exists but is not a valid git repository.`);
      if (m.includes("ambiguous argument")) throw unexpected(`Invalid git reference or date format. Please check your date parameters: since="${since}", until="${until}"`);
      if (m.includes("timeout")) throw unexpected(`Git operation timed out after 30 seconds for repository ${repo}. The repository may be too large or the git operation is taking too long.`);
      throw new Error(`Failed to search commits in repository ${repo}: ${m}`);
    }
  },
});

const listRepos = define({
  name: "list_repos",
  description: t.list_repos!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    query: z.string().describe(p("list_repos", "query")).optional(),
    page: z.number().int().positive().describe(p("list_repos", "page")).optional().default(1),
    perPage: z.number().int().positive().max(100).describe(p("list_repos", "perPage")).optional().default(30),
    sort: z.enum(["name", "pushed"]).describe(p("list_repos", "sort")).optional().default("name"),
    direction: z.enum(["asc", "desc"]).describe(p("list_repos", "direction")).optional().default("asc"),
  }),
  async execute({ query, page = 1, perPage = 30, sort = "name", direction = "asc" }, ctx) {
    const visible = (await ctx.deps.listRepos({ query, sort, direction })).filter((r) => ctx.scope.allows(r.name));
    const repos = visible.slice((page - 1) * perPage, page * perPage);
    const totalCount = visible.length;
    return {
      output: JSON.stringify({
        repos: repos.map((r) => ({
          name: r.name,
          url: `${ctx.deps.baseUrl}${browsePath(r.name, "", "tree")}`,
          pushedAt: r.pushedAt?.toISOString() ?? null,
          defaultBranch: r.defaultBranch ?? null,
          isFork: r.isFork,
          isArchived: r.isArchived,
        })),
        totalCount,
      }),
    };
  },
});

const getDiff = define({
  name: "get_diff",
  description: t.get_diff!.description,
  isReadOnly: true,
  isIdempotent: true,
  inputSchema: z.object({
    repo: z.string().describe(p("get_diff", "repo")),
    base: z.string().describe(p("get_diff", "base")),
    head: z.string().describe(p("get_diff", "head")),
    path: z.string().describe(p("get_diff", "path")).optional(),
  }),
  async execute({ repo, base, head, path }, ctx) {
    if (!isGitRefValid(base)) throw invalidGitRef(base);
    if (!isGitRefValid(head)) throw invalidGitRef(head);
    const r = await repoOrThrow(ctx, repo);
    let raw: string;
    try {
      raw = await git(r).raw(["diff", base, head, ...(path ? ["--", path] : [])]);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes("unknown revision") || m.includes("bad revision")) throw invalidGitRef(`${base}..${head}`);
      throw unexpected(`Failed to compute diff for ${repo}: ${m}`);
    }
    let out = "";
    const sources: ToolSource[] = [];
    for (const f of parseDiff(raw)) {
      const oldPath = f.from && f.from !== "/dev/null" ? f.from : null;
      const newPath = f.to && f.to !== "/dev/null" ? f.to : null;
      if (newPath === null) {
        if (oldPath) sources.push(fileSource(r.name, oldPath, base));
      } else if (oldPath && oldPath !== newPath) sources.push(fileSource(r.name, oldPath, base), fileSource(r.name, newPath, head));
      else sources.push(fileSource(r.name, newPath, head));
      out += oldPath ? `--- a/${oldPath}\n` : "--- /dev/null\n";
      out += newPath ? `+++ b/${newPath}\n` : "+++ /dev/null\n";
      for (const h of f.chunks) {
        const heading = /^@@ .+ @@ (.+)$/.exec(h.content)?.[1]?.trim();
        const body = h.changes.map((c) => c.content).join("\n");
        out += `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${heading ? ` ${heading}` : ""}\n${body}${body.endsWith("\n") ? "" : "\n"}`;
      }
    }
    return { output: out, sources };
  },
});

// ---- registry ----

export const toolDefinitions = {
  grep,
  glob,
  get_diff: getDiff,
  list_commits: listCommits,
  list_branches: listBranches,
  list_repos: listRepos,
  read_file: readFile,
  list_tree: listTree,
  find_symbol_definitions: findSymbolDefinitions,
  find_symbol_references: findSymbolReferences,
} as const;

export type ToolName = keyof typeof toolDefinitions;
/** In MCP registration order. */
export const toolNames = Object.keys(toolDefinitions) as ToolName[];
export type AnyToolDefinition = ToolDefinition<z.ZodRawShape>;

/** OpenAI-style function specs for the Ask agent. */
export function openAiTools(names: ToolName[] = toolNames) {
  return names.map((n) => {
    const d = toolDefinitions[n] as unknown as AnyToolDefinition;
    return { type: "function" as const, function: { name: n, description: d.description, parameters: toolJsonSchema(d.inputSchema) } };
  });
}

/** Runs a tool by name with raw arguments; returns its output text and throws its error. */
export function createToolRunner(deps: ToolDeps) {
  return async function runTool(name: string, rawArgs: unknown, scope: Scope, selectedRepos?: string[]): Promise<string> {
    const d = toolDefinitions[name as ToolName] as unknown as AnyToolDefinition | undefined;
    if (!d) throw new Error(`unknown tool: ${name}`);
    return (await d.execute(d.inputSchema.parse(rawArgs ?? {}), { deps, scope, selectedRepos })).output;
  };
}


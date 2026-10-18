import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as git from "./git";
import { escapeRegex, qAnd, qBranch, qFileName, qOr, qRepo, qSymbol, reExact, type Q } from "./ir";
import { searchIR, type SearchResponse } from "./zoekt";
import type { Scope } from "./access";

export interface ToolDeps {
  /** Every repo matching the query, ordered; the runner applies scope and paging. */
  listRepos(o: { query?: string; sort: "name" | "pushed"; direction: "asc" | "desc" }): Promise<{ name: string; defaultBranch: string | null; status: string; pushedAt: Date | null }[]>;
}

/** Shared tool specs: used by the MCP server (zod shapes) and the Ask agent (JSON schema). */
export const toolSpecs = {
  grep: {
    description: "Case-sensitive regex search across file contents, grouped by file with line numbers.",
    shape: {
      pattern: z.string().describe("RE2 regex"),
      path: z.string().optional().describe("Restrict to paths matching this regex"),
      include: z.string().optional().describe("Glob for file names, e.g. *.ts"),
      repo: z.string().optional().describe("Exact repo name"),
      ref: z.string().optional().describe("Branch (must be indexed)"),
      limit: z.number().int().positive().max(1000).optional().describe("Max matches, default 100"),
    },
  },
  glob: {
    description: "Find file paths matching a glob pattern, grouped by repository.",
    shape: {
      pattern: z.string().describe("Glob, e.g. src/**/*.ts"),
      path: z.string().optional(),
      repo: z.string().optional(),
      ref: z.string().optional(),
      limit: z.number().int().positive().max(1000).optional(),
    },
  },
  list_repos: {
    description: "List indexed repositories.",
    shape: {
      query: z.string().optional(),
      page: z.number().int().positive().optional(),
      perPage: z.number().int().positive().max(100).optional(),
      sort: z.enum(["name", "pushed"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
    },
  },
  read_file: {
    description: "Read a file, optionally a line range (offset is 1-based).",
    shape: {
      repo: z.string(),
      path: z.string(),
      ref: z.string().optional(),
      offset: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
  },
  list_tree: {
    description: "List files and directories at a path, directories first.",
    shape: {
      repo: z.string(),
      path: z.string().optional(),
      ref: z.string().optional(),
      depth: z.number().int().min(1).max(10).optional(),
      includeFiles: z.boolean().optional(),
      includeDirectories: z.boolean().optional(),
      maxEntries: z.number().int().positive().max(10000).optional(),
    },
  },
  list_commits: {
    description: "List commits, filterable by message, date range, author.",
    shape: {
      repo: z.string(),
      query: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      author: z.string().optional(),
      ref: z.string().optional(),
      page: z.number().int().positive().optional(),
      perPage: z.number().int().positive().max(200).optional(),
    },
  },
  list_branches: {
    description: "List branches, newest first, from the local snapshot.",
    shape: {
      repo: z.string(),
      query: z.string().optional(),
      page: z.number().int().positive().optional(),
      perPage: z.number().int().positive().max(200).optional(),
    },
  },
  get_diff: {
    description: "Two-dot diff between two refs.",
    shape: { repo: z.string(), base: z.string(), head: z.string() },
  },
  find_symbol_definitions: {
    description: "Find where a symbol is defined within a repository (ctags).",
    shape: { symbol: z.string(), repo: z.string() },
  },
  find_symbol_references: {
    description: "Find usages of a symbol within a repository.",
    shape: { symbol: z.string(), repo: z.string() },
  },
} as const;

export type ToolName = keyof typeof toolSpecs;
export const toolNames = Object.keys(toolSpecs) as ToolName[];

export function openAiTools(names: ToolName[] = toolNames) {
  return names.map((n) => ({
    type: "function" as const,
    function: {
      name: n,
      description: toolSpecs[n].description,
      parameters: zodToJsonSchema(z.object(toolSpecs[n].shape), { $refStrategy: "none" }),
    },
  }));
}

/**
 * Glob to RE2. A double star crosses directories, a single star and `?` do not. A double star followed by a
 * slash matches zero or more whole directories, so the glob src, double star, slash, test.ts matches
 * `src/test.ts` and `src/a/test.ts` but not `src/contest.ts`.
 * A glob without a slash matches the file name at any depth; one with a slash is anchored at the repo root.
 */
export function globToRegex(glob: string): string {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return `${glob.includes("/") ? "^" : "(?:^|/)"}${re}$`;
}

/** Indexed revisions are full refs (refs/heads/x, refs/tags/x); accept a short name or a full ref. */
const refNode = (ref: string): Q =>
  ref.startsWith("refs/") || ref === "HEAD"
    ? qBranch(ref, true)
    : qOr(qBranch(ref, true), qBranch(`refs/heads/${ref}`, true), qBranch(`refs/tags/${ref}`, true));

/** Narrowing nodes from tool arguments. Each argument is a leaf value, never query syntax. */
function argNodes(a: { repo?: string; ref?: string; path?: string }): Q[] {
  const p: Q[] = [];
  if (a.repo) p.push(qRepo(reExact(a.repo)));
  if (a.ref) p.push(refNode(a.ref));
  if (a.path) p.push(qFileName(a.path, true));
  return p;
}

const contentRegex = (regexp: string, caseSensitive = true): Q => ({
  regexp: { regexp, file_name: false, content: true, case_sensitive: caseSensitive },
});

function formatMatches(r: SearchResponse, limit: number): string {
  if (!r.files.length) return "No matches.";
  const out: string[] = [];
  let n = 0;
  for (const f of r.files) {
    const lines: string[] = [];
    for (const m of f.matches) {
      if (n >= limit) break;
      if (m.fileNameMatch) continue;
      lines.push(`  ${m.lineNumber}: ${m.text.length > 300 ? m.text.slice(0, 300) + "…" : m.text}`);
      n++;
    }
    if (lines.length) out.push(`${f.repo}:${f.path}\n${lines.join("\n")}`);
    if (n >= limit) break;
  }
  return out.join("\n\n") + (r.matchCount > n || !r.isSearchExhaustive ? `\n\n(${r.matchCount}${r.isSearchExhaustive ? "" : "+"} total matches, showing ${n})` : "");
}

/** Same wording as a repo that does not exist, so a scoped key cannot probe for hidden repos. */
const notFound = (repo: string) => new Error(`repo not found: ${repo}`);

export function createToolRunner(deps: ToolDeps) {
  return async function runTool(name: string, rawArgs: unknown, scope: Scope): Promise<string> {
    if (!(name in toolSpecs)) throw new Error(`unknown tool: ${name}`);
    const spec = toolSpecs[name as ToolName];
    const a = z.object(spec.shape).parse(rawArgs ?? {}) as any;
    if (typeof a.repo === "string" && !scope.allows(a.repo)) throw notFound(a.repo);

    // The scope node narrows the query; filtering the hits is the guarantee.
    const find = async (q: Q, opts: { matches?: number }) => {
      const r = await searchIR(q, opts, scope.repoFilter ? [qRepo(scope.repoFilter)] : []);
      const files = r.files.filter((f) => scope.allows(f.repo));
      if (files.length === r.files.length) return r;
      return { ...r, files, fileCount: files.length, matchCount: files.reduce((n, f) => n + f.occurrences, 0) };
    };

    switch (name as ToolName) {
      case "grep": {
        const q = qAnd(contentRegex(a.pattern), ...argNodes(a), ...(a.include ? [qFileName(globToRegex(a.include), true)] : []));
        return formatMatches(await find(q, { matches: 5000 }), a.limit ?? 100);
      }
      case "glob": {
        const r = await find(qAnd(qFileName(globToRegex(a.pattern), true), ...argNodes(a)), {
          matches: a.limit ?? 100,
        });
        const byRepo = new Map<string, string[]>();
        for (const f of r.files) byRepo.set(f.repo, [...(byRepo.get(f.repo) ?? []), f.path]);
        return byRepo.size
          ? [...byRepo].map(([repo, paths]) => `${repo}\n${paths.map((p) => "  " + p).join("\n")}`).join("\n\n")
          : "No files.";
      }
      case "list_repos": {
        const all = (await deps.listRepos({ query: a.query, sort: a.sort ?? "name", direction: a.direction ?? "asc" })).filter((r) => scope.allows(r.name));
        const perPage = a.perPage ?? 50;
        const rows = all.slice(((a.page ?? 1) - 1) * perPage, (a.page ?? 1) * perPage);
        return JSON.stringify({ repos: rows.map((r) => ({ name: r.name, defaultBranch: r.defaultBranch, status: r.status })) });
      }
      case "read_file": {
        const text = await git.readFile(a.repo, a.path, a.ref);
        const lines = text.split("\n");
        const start = (a.offset ?? 1) - 1;
        const limit = a.limit ?? 500;
        const slice = lines.slice(start, start + limit);
        const width = String(start + slice.length).length;
        const body = slice.map((l, i) => `${String(start + i + 1).padStart(width)}| ${l}`).join("\n");
        const more = start + limit < lines.length ? `\n(truncated; ${lines.length} lines total, continue with offset=${start + limit + 1})` : "";
        return body + more;
      }
      case "list_tree": {
        const depth = a.depth ?? 1;
        const base = (a.path ?? "").replace(/^\/+|\/+$/g, "");
        const entries = await git.listTree(a.repo, a.ref ?? "HEAD", base, depth > 1);
        const baseDepth = base ? base.split("/").length : 0;
        let sel = entries.filter((e) => e.path !== base && e.path.split("/").length - baseDepth <= depth);
        if (a.includeFiles === false) sel = sel.filter((e) => e.type === "dir");
        if (a.includeDirectories === false) sel = sel.filter((e) => e.type === "file");
        sel.sort((x, y) => (x.type === y.type ? x.path.localeCompare(y.path) : x.type === "dir" ? -1 : 1));
        const max = a.maxEntries ?? 1000;
        return sel.slice(0, max).map((e) => (e.type === "dir" ? e.path + "/" : e.path)).join("\n") +
          (sel.length > max ? `\n(truncated at ${max})` : "");
      }
      case "list_commits": {
        const perPage = a.perPage ?? 50;
        const cs = await git.listCommits(a.repo, { ...a, skip: ((a.page ?? 1) - 1) * perPage, limit: perPage });
        return cs.map((c) => `${c.hash.slice(0, 10)} ${c.date} ${c.author}: ${c.subject}`).join("\n") || "No commits.";
      }
      case "list_branches": {
        const perPage = a.perPage ?? 50;
        let bs = await git.listBranches(a.repo);
        if (a.query) bs = bs.filter((b) => b.name.toLowerCase().includes(a.query.toLowerCase()));
        const s = ((a.page ?? 1) - 1) * perPage;
        return bs.slice(s, s + perPage).map((b) => `${b.name}  ${b.date}`).join("\n") || "No branches.";
      }
      case "get_diff":
        return (await git.diff(a.repo, a.base, a.head)) || "No differences.";
      case "find_symbol_definitions": {
        const r = await find(qAnd(qSymbol(contentRegex(reExact(a.symbol))), ...argNodes(a)), { matches: 200 });
        return formatMatches(r, 100);
      }
      case "find_symbol_references": {
        const r = await find(qAnd(contentRegex(`\\b${escapeRegex(a.symbol)}\\b`), ...argNodes(a)), { matches: 500 });
        return formatMatches(r, 100);
      }
    }
  };
}

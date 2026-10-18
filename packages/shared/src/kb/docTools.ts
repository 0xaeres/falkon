import { z } from "zod";
import { extractCitations } from "./citations";
import { MAX_DOC_CHARS, MIN_DOC_CHARS } from "./limits";
import { extractTitle } from "./markdown";
import { isDocPath } from "./paths";
import type { RepoSource } from "./source";
import type { CitationRef, DocRecord } from "./triage";
import { tool, type ToolDef } from "./llm";

/** Where documents live while a scan runs. Implemented over a git worktree in the backend, in memory in tests. */
export interface DocStore {
  /** Paths of every document currently in the knowledge repo, excluding README.md. */
  listPaths(): Promise<string[]>;
  read(path: string): Promise<string | undefined>;
  write(path: string, body: string): Promise<void>;
  /** Delete the file and commit the deletion. */
  remove(path: string, message: string): Promise<void>;
  /** Commit one path. `committed` is false when the content did not change. */
  commit(path: string, message: string): Promise<{ committed: boolean }>;
  records: {
    all(): Promise<DocRecord[]>;
    put(rec: DocRecord): Promise<void>;
    drop(path: string): Promise<void>;
  };
}

export interface DocContext {
  store: DocStore;
  owner: RepoSource;
  resolveRepo: (name: string) => Promise<RepoSource | undefined>;
  scanId: number;
  model: string;
}

export type Refusal = { ok: false; reason: string; message: string; [k: string]: unknown };
const refuse = (reason: string, message: string, extra: Record<string, unknown> = {}): Refusal => ({ ok: false, reason, message, ...extra });

/** Resolve every citation against the file tree it points at. Returns the verified refs or the ones that dangle. */
export async function verifyCitations(
  body: string,
  ctx: Pick<DocContext, "owner" | "resolveRepo">,
): Promise<{ ok: true; refs: CitationRef[] } | { ok: false; dangling: { repo: string; path: string; detail: string }[] }> {
  const refs: CitationRef[] = [];
  const dangling: { repo: string; path: string; detail: string }[] = [];
  const cache = new Map<string, RepoSource | undefined>();
  for (const c of extractCitations(body)) {
    if (!cache.has(c.repo)) cache.set(c.repo, c.repo === ctx.owner.name ? ctx.owner : await ctx.resolveRepo(c.repo));
    const src = cache.get(c.repo);
    if (!src) dangling.push({ ...c, detail: "unknown or unavailable repo" });
    else if (!(await src.exists(c.path))) dangling.push({ ...c, detail: `file not found at ${src.commit.slice(0, 10)}` });
    else refs.push({ repo: c.repo, path: c.path, commit: src.commit });
  }
  return dangling.length ? { ok: false, dangling } : { ok: true, refs };
}

const commitMessage = (action: string, path: string, scanId: number, reasons: string[]) =>
  [`kb: ${action} ${path}`, "", ...reasons.map((r) => `- ${r}`), "", `Scan: ${scanId}`].join("\n");

export interface ItemScope {
  /** the one document this agent may write */
  path: string;
  /** documents folded into it; deletable once it is finished */
  absorbs: string[];
  /** why this document is being touched (delta triage), copied into commit messages */
  reasons: string[];
  isNew: boolean;
}

/**
 * The document tools one doc agent gets. All writes are confined to its own path; deleting is allowed only for
 * the documents it absorbs, and only after its own document is finished, so a crash never loses content.
 */
export function docTools(ctx: DocContext, item: ItemScope, state: { finished: boolean; written?: boolean }): ToolDef[] {
  const own = (p: string) => (p === item.path ? undefined : refuse("outside_item", `You may only write ${item.path}; ${p} is outside this work item.`));
  const valid = (p: string) => (isDocPath(p) ? undefined : refuse("invalid_path", `Invalid document path: ${p}`));

  return [
    tool(
      "write_doc",
      "Create or fully replace your document. Pass the complete Markdown body.",
      z.object({ path: z.string(), body: z.string() }),
      async ({ path, body }) => {
        const bad = valid(path) ?? own(path);
        if (bad) return bad;
        if (body.length > MAX_DOC_CHARS) return refuse("over_cap", `Document is ${body.length} characters; the maximum is ${MAX_DOC_CHARS}. Trim it or split the concept.`);
        await ctx.store.write(path, body);
        state.finished = false;
        state.written = true;
        return { ok: true, chars: body.length };
      },
    ),
    tool(
      "edit_doc",
      "Replace exactly one occurrence of oldText with newText in your document.",
      z.object({ path: z.string(), oldText: z.string().min(1), newText: z.string() }),
      async ({ path, oldText, newText }) => {
        const bad = valid(path) ?? own(path);
        if (bad) return bad;
        const cur = await ctx.store.read(path);
        if (cur === undefined) return refuse("doc_not_found", `${path} does not exist yet; use write_doc.`);
        const n = cur.split(oldText).length - 1;
        if (n === 0) return refuse("no_match", "oldText was not found.");
        if (n > 1) return refuse("ambiguous_match", `oldText matches ${n} places; include more context.`);
        const next = cur.replace(oldText, () => newText);
        if (next.length > MAX_DOC_CHARS) return refuse("over_cap", `Result would be ${next.length} characters; the maximum is ${MAX_DOC_CHARS}.`);
        await ctx.store.write(path, next);
        state.finished = false;
        return { ok: true };
      },
    ),
    tool(
      "finish_doc",
      "Validate and commit your finished document. Required. Call it for your own path once the body is complete.",
      z.object({
        path: z.string(),
        summary: z.string().min(1).describe("One plain sentence: when to read this document and what it covers."),
      }),
      async ({ path, summary }) => {
        const bad = valid(path) ?? own(path);
        if (bad) return bad;
        const body = await ctx.store.read(path);
        if (body === undefined) return refuse("doc_not_found", `${path} has not been written.`);
        if (body.trimStart().startsWith("---")) return refuse("frontmatter_forbidden", "Remove the frontmatter: begin with a single H1.");
        if (body.length > MAX_DOC_CHARS) return refuse("over_cap", `Document is ${body.length} characters; the maximum is ${MAX_DOC_CHARS}.`);
        if (body.trim().length < MIN_DOC_CHARS) return refuse("too_short", `Document is only ${body.trim().length} characters; write a substantive document (at least ${MIN_DOC_CHARS}).`);
        if (!/^#\s+\S/.test(body.trimStart())) return refuse("missing_title", "Begin the document with a single H1 title.");
        const v = await verifyCitations(body, ctx);
        if (!v.ok) return refuse("dangling_citations", "These citations do not resolve at the scanned commit. Fix or remove them.", { dangling: v.dangling });
        const { committed } = await ctx.store.commit(path, commitMessage(item.isNew ? "add" : "update", path, ctx.scanId, item.reasons));
        void committed;
        await ctx.store.records.put({
          path,
          title: extractTitle(body),
          summary: summary.trim(),
          citations: v.refs,
          generatedAtCommit: ctx.owner.commit,
          model: ctx.model,
          scanId: ctx.scanId,
        });
        state.finished = true;
        return { ok: true };
      },
    ),
    tool(
      "delete_absorbed_doc",
      "Delete a document your item absorbs, after you have finished your own document and folded its content in.",
      z.object({ path: z.string() }),
      async ({ path }) => {
        if (!item.absorbs.includes(path)) return refuse("outside_item", `You may only delete documents you absorb (${item.absorbs.join(", ") || "none"}).`);
        if (!state.finished) return refuse("finish_required", `Call finish_doc for ${item.path} before deleting ${path}.`);
        if ((await ctx.store.read(path)) === undefined) return { ok: true, note: "already gone" };
        await ctx.store.remove(path, commitMessage(`merge into ${item.path}:`, path, ctx.scanId, []));
        await ctx.store.records.drop(path);
        return { ok: true };
      },
    ),
  ];
}

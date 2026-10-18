import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "@sbc/db";
import { kb } from "@sbc/shared";

const run = promisify(execFile);

const AUTHOR = { GIT_AUTHOR_NAME: "Knowledge Base", GIT_AUTHOR_EMAIL: "knowledge-base@localhost", GIT_COMMITTER_NAME: "Knowledge Base", GIT_COMMITTER_EMAIL: "knowledge-base@localhost" };

/**
 * Documents live in a bare git repo (so Zoekt can index it and the git tools can read it), edited through a
 * throwaway work tree. Every committed document is one commit, so history shows why each document changed.
 */
export class GitDocStore implements kb.DocStore {
  private tree = "";
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly gitDir: string,
    private readonly ownerRepoId: number,
    private readonly cache: { commitCount: number } = { commitCount: 0 },
  ) {}

  private git(args: string[], opts: { allowFail?: boolean } = {}) {
    const env = { ...process.env, ...AUTHOR, GIT_DIR: this.gitDir, GIT_WORK_TREE: this.tree };
    return run("git", args, { env, cwd: this.tree, maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
      if (opts.allowFail) return { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
      throw e;
    });
  }

  /** Create the bare repo if needed and check the current tree out into a fresh work tree. */
  async open(): Promise<void> {
    if (!fs.existsSync(path.join(this.gitDir, "HEAD"))) {
      fs.mkdirSync(this.gitDir, { recursive: true });
      await run("git", ["init", "--bare", "-b", "main", this.gitDir]);
    }
    this.tree = fs.mkdtempSync(path.join(os.tmpdir(), "kb-tree-"));
    const hasMain = await run("git", ["--git-dir", this.gitDir, "rev-parse", "--verify", "-q", "refs/heads/main"]).then(() => true, () => false);
    if (hasMain) await this.git(["checkout", "-f", "main"]);
  }

  close(): void {
    if (this.tree) fs.rmSync(this.tree, { recursive: true, force: true });
    this.tree = "";
  }

  /** Whether any commit was made through this store (so the caller knows to re-index). */
  get committed() {
    return this.cache.commitCount > 0;
  }

  private abs(p: string) {
    const full = path.resolve(this.tree, p);
    if (!full.startsWith(this.tree + path.sep)) throw new Error(`path escapes the work tree: ${p}`);
    // a symlink in the tree (hand-edited history) must not redirect reads or writes outside it
    for (let dir = full; dir.length > this.tree.length; dir = path.dirname(dir)) {
      try {
        if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`refusing to follow a symlink: ${p}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return full;
  }

  /** Commits are serialized: git's index is a single shared file. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async listPaths(): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".md")) out.push(path.relative(this.tree, full).split(path.sep).join("/"));
      }
    };
    walk(this.tree);
    return out.filter((p) => p !== "README.md").sort();
  }

  async read(p: string) {
    try {
      return fs.readFileSync(this.abs(p), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }

  async write(p: string, body: string) {
    const f = this.abs(p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }

  async commit(p: string, message: string) {
    return this.serial(async () => {
      await this.git(["add", "-A", "--", p]);
      const staged = await this.git(["diff", "--cached", "--name-only", "--", p]);
      if (!staged.stdout.trim()) return { committed: false };
      await this.git(["commit", "-q", "-m", message, "--", p]);
      this.cache.commitCount++;
      return { committed: true };
    });
  }

  async remove(p: string, message: string) {
    fs.rmSync(this.abs(p), { force: true });
    // prune the now-empty system folder so the tree stays clean
    const dir = path.dirname(this.abs(p));
    if (dir !== this.tree && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    await this.commit(p, message);
  }

  records: kb.DocStore["records"] = {
    all: async () =>
      (await prisma.knowledgeDoc.findMany({ where: { repoId: this.ownerRepoId } })).map<kb.DocRecord>((r) => ({
        path: r.path, title: r.title, summary: r.summary, citations: r.citations as unknown as kb.CitationRef[],
        generatedAtCommit: r.generatedAtCommit, model: r.model, scanId: r.scanId,
      })),
    put: async (r) => {
      const data = { title: r.title, summary: r.summary, citations: r.citations as any, model: r.model, generatedAtCommit: r.generatedAtCommit, scanId: r.scanId };
      await prisma.knowledgeDoc.upsert({ where: { repoId_path: { repoId: this.ownerRepoId, path: r.path } }, create: { repoId: this.ownerRepoId, path: r.path, ...data }, update: data });
    },
    drop: async (p) => void (await prisma.knowledgeDoc.deleteMany({ where: { repoId: this.ownerRepoId, path: p } })),
  };
}

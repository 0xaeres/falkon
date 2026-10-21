import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileInfo } from "./territories";

const run = promisify(execFile);

export interface DiffRecord {
  status: string; // A, M, D, T, Rnn, Cnn
  path: string;
  oldPath?: string;
}

/** A repository frozen at one commit. Every read an agent makes goes through this, so a scan sees one consistent tree. */
export interface RepoSource {
  readonly name: string;
  readonly commit: string;
  listFiles(): Promise<FileInfo[]>;
  /** Files under a directory prefix, repo-relative. */
  listTree(prefix?: string): Promise<string[]>;
  /** Text of a file, or undefined if missing or binary. */
  readFile(path: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
  grep(pattern: string, prefix?: string, max?: number): Promise<string>;
  log(path: string, max?: number): Promise<string>;
  diff(baseCommit: string): Promise<DiffRecord[] | "missing-base">;
  commitsSince(baseCommit: string, max?: number): Promise<{ sha: string; subject: string }[] | "missing-base">;
}

const safeRev = (r: string) => {
  if (!r || r.startsWith("-") || /[\0\s]/.test(r)) throw new Error(`invalid revision: ${r}`);
  return r;
};

/** Parse `git diff --name-status -z -M` output. */
export function parseNameStatus(out: string): DiffRecord[] {
  const f = out.split("\0");
  if (f.at(-1) === "") f.pop();
  const recs: DiffRecord[] = [];
  for (let i = 0; i < f.length; ) {
    const status = f[i++]!;
    if (!status) continue;
    if (status[0] === "R" || status[0] === "C") {
      const oldPath = f[i++];
      const path = f[i++];
      if (oldPath === undefined || path === undefined) throw new Error("malformed rename record");
      recs.push({ status, oldPath, path });
    } else {
      const path = f[i++];
      if (path === undefined) throw new Error("malformed name-status record");
      recs.push({ status, path });
    }
  }
  return recs;
}

const MAX_FILE = 400_000;

export function gitSource(name: string, gitDir: string, commit: string): RepoSource {
  safeRev(commit);
  const git = async (args: string[], ok: number[] = [0]) => {
    try {
      const { stdout } = await run("git", ["--git-dir", gitDir, ...args], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });
      return { code: 0, out: stdout as unknown as Buffer };
    } catch (e: any) {
      if (ok.includes(e.code)) return { code: e.code as number, out: (e.stdout ?? Buffer.alloc(0)) as Buffer, err: String(e.stderr ?? "") };
      throw e;
    }
  };
  const missingBase = /bad object|invalid revision|not a valid object|bad revision|unknown revision/i;

  return {
    name,
    commit,
    async listFiles() {
      const { out } = await git(["ls-tree", "-r", "-l", "-z", commit]);
      return out
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .flatMap((entry) => {
          const tab = entry.indexOf("\t");
          const meta = entry.slice(0, tab).trim().split(/\s+/);
          return meta[1] === "blob" ? [{ path: entry.slice(tab + 1), size: Number(meta[3]) || 0 }] : [];
        });
    },
    async listTree(prefix = "") {
      const p = prefix.replace(/^\/+|\/+$/g, "");
      const { out } = await git(["ls-tree", "-r", "--name-only", "-z", commit, ...(p ? ["--", `${p}/`] : [])]);
      return out.toString("utf8").split("\0").filter(Boolean);
    },
    async readFile(path) {
      const r = await git(["show", `${commit}:${path.replace(/^\/+/, "")}`], [128]);
      if (r.code !== 0 || r.out.length > MAX_FILE || r.out.subarray(0, 8000).includes(0)) return undefined;
      return r.out.toString("utf8");
    },
    async exists(path) {
      // a directory (tree) is not file evidence: its contents can change without the citation noticing
      const r = await git(["cat-file", "-t", `${commit}:${path.replace(/^\/+/, "")}`], [128, 1]);
      return r.code === 0 && r.out.toString("utf8").trim() === "blob";
    },
    async grep(pattern, prefix = "", max = 60) {
      const p = prefix.replace(/^\/+|\/+$/g, "");
      const r = await git(["grep", "-n", "-I", "-E", "--max-count=5", "-e", pattern, commit, "--", ...(p ? [p] : [])], [1, 128]);
      const lines = r.out.toString("utf8").split("\n").filter(Boolean).map((l) => l.replace(`${commit}:`, ""));
      return lines.slice(0, max).join("\n") + (lines.length > max ? `\n…(${lines.length - max} more)` : "") || "No matches.";
    },
    async log(path, max = 15) {
      const r = await git(["log", `--max-count=${max}`, "--format=%h %ad %s", "--date=short", commit, "--", path], [128]);
      return r.out.toString("utf8").trim() || "No history.";
    },
    async diff(base) {
      safeRev(base);
      if (base === commit) return [];
      const r = await git(["-c", "diff.renames=true", "diff", "-M", "--name-status", "-z", base, commit], [128, 129]);
      if (r.code !== 0) {
        if (missingBase.test(r.err ?? "")) return "missing-base";
        throw new Error(`git diff failed: ${r.err}`);
      }
      return parseNameStatus(r.out.toString("utf8"));
    },
    async commitsSince(base, max = 50) {
      safeRev(base);
      if (base === commit) return [];
      const r = await git(["log", `${base}..${commit}`, "--format=%H%x1f%s", "-n", String(max)], [128, 129]);
      if (r.code !== 0) return missingBase.test(r.err ?? "") ? "missing-base" : [];
      return r.out
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [sha = "", ...s] = l.split("\x1f");
          return { sha, subject: s.join("\x1f") };
        });
    },
  };
}

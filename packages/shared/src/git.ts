import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { repoGitDir } from "./env";

const run = promisify(execFile);

function assertSafeRef(ref: string) {
  if (!ref || ref.startsWith("-") || /[\0\n]/.test(ref)) throw new Error(`invalid ref: ${ref}`);
}

async function git(repo: string, args: string[], maxBuffer = 64 * 1024 * 1024) {
  const dir = repoGitDir(repo);
  if (!fs.existsSync(dir)) throw new Error(`repo not found: ${repo}`);
  const { stdout } = await run("git", ["--git-dir", dir, ...args], {
    maxBuffer,
    encoding: "buffer",
  });
  return stdout as unknown as Buffer;
}

export async function readFile(repo: string, filePath: string, ref = "HEAD"): Promise<string> {
  assertSafeRef(ref);
  const buf = await git(repo, ["show", `${ref}:${filePath.replace(/^\/+/, "")}`]);
  if (buf.subarray(0, 8000).includes(0)) throw new Error("binary file");
  return buf.toString("utf8");
}

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

export async function listTree(repo: string, ref = "HEAD", dir = "", recursive = false): Promise<TreeEntry[]> {
  assertSafeRef(ref);
  const prefix = dir.replace(/^\/+|\/+$/g, "");
  const args = ["ls-tree", "-z", ...(recursive ? ["-r", "-t"] : []), ref];
  if (prefix) args.push(`${prefix}/`);
  const out = (await git(repo, args)).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      // "<mode> <type> <sha>\t<path>"
      const tab = line.indexOf("\t");
      const [, type] = line.slice(0, tab).split(" ");
      return { path: line.slice(tab + 1), type: type === "tree" ? ("dir" as const) : ("file" as const) };
    });
}

export async function listBranches(repo: string): Promise<{ name: string; date: string }[]> {
  const out = (
    await git(repo, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\t%(committerdate:iso-strict)", "refs/heads"])
  ).toString("utf8");
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [name, date] = l.split("\t");
      return { name, date };
    });
}

export interface CommitInfo {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export async function listCommits(
  repo: string,
  o: { ref?: string; query?: string; since?: string; until?: string; author?: string; skip?: number; limit?: number } = {},
): Promise<CommitInfo[]> {
  const ref = o.ref ?? "HEAD";
  assertSafeRef(ref);
  const args = ["log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", `--max-count=${o.limit ?? 50}`, `--skip=${o.skip ?? 0}`];
  if (o.query) args.push("-i", `--grep=${o.query}`);
  if (o.since) args.push(`--since=${o.since}`);
  if (o.until) args.push(`--until=${o.until}`);
  if (o.author) args.push(`--author=${o.author}`);
  args.push(ref, "--");
  const out = (await git(repo, args)).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .map((r) => {
      const [hash, author, date, subject] = r.split("\x1f");
      return { hash, author, date, subject };
    });
}

export async function diff(repo: string, base: string, head: string): Promise<string> {
  assertSafeRef(base);
  assertSafeRef(head);
  return (await git(repo, ["diff", "--no-color", base, head, "--"])).toString("utf8");
}

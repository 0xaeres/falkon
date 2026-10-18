import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** HTTP credentials for one clone URL. Never written to disk or argv. */
export interface GitCredentials {
  username: string;
  password: string;
}

/**
 * Credentials ride in GIT_CONFIG_* env as a basic-auth header scoped to the clone URL, so they
 * never land in .git/config, argv or the process list. Prompts are disabled.
 */
function gitEnv(cloneUrl?: string, creds?: GitCredentials): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", SSH_ASKPASS: "/bin/false" };
  const entries: [string, string][] = [];
  if (creds && cloneUrl && /^https?:/.test(cloneUrl)) {
    for (const v of [creds.username, creds.password]) if (/[\r\n\0]/.test(v)) throw new Error("git credentials contain a control character");
    const u = new URL(cloneUrl);
    const basic = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
    entries.push([`http.${u.origin}/.extraHeader`, `Authorization: Basic ${basic}`]);
  }
  // Keep whatever GIT_CONFIG_* the process already has (e.g. safe.directory) and append ours.
  const base = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  entries.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${base + i}`] = k;
    env[`GIT_CONFIG_VALUE_${base + i}`] = v;
  });
  env.GIT_CONFIG_COUNT = String(base + entries.length);
  return env;
}

export async function git(dir: string | undefined, args: string[], opts: { cloneUrl?: string; creds?: GitCredentials; signal?: AbortSignal } = {}) {
  const { stdout } = await run("git", dir ? ["-C", dir, ...args] : args, {
    env: gitEnv(opts.cloneUrl, opts.creds),
    maxBuffer: 64 * 1024 * 1024,
    signal: opts.signal,
  });
  return stdout.trim();
}

/** Root of a work tree or bare repo. */
export async function isRepoRoot(p: string) {
  if (!fs.existsSync(p)) return false;
  try {
    const d = await git(p, ["rev-parse", "--git-dir"]);
    return d === "." || d === ".git";
  } catch {
    return false;
  }
}

async function remoteDefaultBranch(cloneUrl: string, creds?: GitCredentials, signal?: AbortSignal) {
  try {
    const out = await git(undefined, ["ls-remote", "--symref", "--", cloneUrl, "HEAD"], { cloneUrl, creds, signal });
    return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(out)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Bare clone on first sync (origin URL removed afterwards: it may hold credentials and is never
 * needed), else fetch all heads with prune, then point HEAD at the remote's current default branch.
 * A path that exists but is not a repo is wiped first.
 */
export async function cloneOrFetch(dir: string, cloneUrl: string, creds?: GitCredentials, signal?: AbortSignal) {
  if (fs.existsSync(dir) && !(await isRepoRoot(dir))) fs.rmSync(dir, { recursive: true, force: true });
  const o = { cloneUrl, creds, signal };
  if (fs.existsSync(dir)) {
    await git(dir, ["config", "--unset-all", "remote.origin.url"]).catch(() => {});
    await git(dir, ["fetch", "--prune", "--", cloneUrl, "+refs/heads/*:refs/heads/*"], o);
    const head = await remoteDefaultBranch(cloneUrl, creds, signal);
    if (head) await git(dir, ["symbolic-ref", "HEAD", `refs/heads/${head}`]);
  } else {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(undefined, ["clone", "--bare", "--", cloneUrl, dir], o);
    await git(dir, ["config", "--unset-all", "remote.origin.url"]).catch(() => {});
  }
  await git(dir, ["commit-graph", "write", "--reachable", "--changed-paths"]).catch(() => {});
}

export async function upsertGitConfig(dir: string, entries: Record<string, string>) {
  for (const [k, v] of Object.entries(entries)) await git(dir, ["config", k, v]);
}

export async function localDefaultBranch(dir: string) {
  try {
    return /^refs\/heads\/(.+)$/.exec(await git(dir, ["symbolic-ref", "HEAD"]))?.[1];
  } catch {
    return undefined;
  }
}

/** Branches newest-commit first, tags newest first: the order revisions are picked in. */
export async function sortedRefs(dir: string, ns: "refs/heads" | "refs/tags") {
  const sort = ns === "refs/heads" ? "-committerdate" : "-creatordate";
  const out = await git(dir, ["for-each-ref", `--sort=${sort}`, "--format=%(refname:short)", ns]);
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** pushedAt is the newest author date on any branch; headCommit is what HEAD points at. */
export async function repoStats(dir: string) {
  let pushedAt: Date | null = null;
  let headCommit: string | null = null;
  try {
    const d = new Date(await git(dir, ["log", "--all", "-1", "--format=%aI"]));
    pushedAt = Number.isNaN(d.getTime()) ? null : d;
  } catch {
    /* empty repo */
  }
  try {
    headCommit = await git(dir, ["rev-parse", "HEAD"]);
  } catch {
    /* unborn branch */
  }
  return { pushedAt, headCommit, branches: await sortedRefs(dir, "refs/heads").catch(() => []) };
}

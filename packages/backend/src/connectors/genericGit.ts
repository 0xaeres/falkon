import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import GitUrlParse from "git-url-parse";
import { glob } from "glob";
import pLimit from "p-limit";
import type { GenericGitHostConnectionConfig } from "@sbc/shared";
import { joinName, marshalBool, type RepoRecord } from "./types";

const run = promisify(execFile);
const gitLimit = pLimit(100);
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

async function git(cwd: string, args: string[]) {
  return (await run("git", args, { cwd, env, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

/** Root of a work tree (`.git`) or of a bare repo (`.`), not a subdirectory of one. */
async function isRepoRoot(path: string) {
  try {
    const dir = (await git(path, ["rev-parse", "--git-dir"])).trim();
    return dir === ".git" || dir === ".";
  } catch {
    return false;
  }
}

async function originUrl(path: string) {
  try {
    return (await git(path, ["config", "--local", "--get", "remote.origin.url"])).trim() || null;
  } catch {
    return null;
  }
}

async function localDefaultBranch(path: string) {
  try {
    return /^refs\/heads\/(.+)$/.exec((await git(path, ["symbolic-ref", "HEAD"])).trim())?.[1];
  } catch {
    return undefined;
  }
}

/** Host as Go's url.URL keeps it (with an explicit port, even :443), which zoekt uses to name repos. */
const hostWithPort = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? null;

/** file:// connections: each matched directory is a repo indexed in place, named after its origin URL. */
async function compileFile(config: GenericGitHostConnectionConfig): Promise<RepoRecord[]> {
  const pattern = new URL(config.url).pathname;
  const paths = await glob(pattern, { absolute: true });
  if (paths.length === 0) console.warn(`[git] no paths matched '${pattern}'`);
  const repos: RepoRecord[] = [];
  await Promise.all(
    paths.map((p) =>
      gitLimit(async () => {
        const stat = await fs.stat(p).catch(() => null);
        if (!stat?.isDirectory()) return console.warn(`[git] skipping ${p}: not a directory`);
        if (!(await isRepoRoot(p))) return console.warn(`[git] skipping ${p}: not a git repository`);
        const origin = await originUrl(p);
        if (!origin) return console.warn(`[git] skipping ${p}: remote.origin.url not set`);
        const remote = GitUrlParse(origin);
        const name = joinName(hostWithPort(origin) ?? remote.host, decodeURIComponent(remote.pathname).replace(/\.git$/, ""));
        repos.push({
          externalId: remote.toString(),
          codeHostType: "genericGitHost",
          codeHostUrl: remote.resource,
          cloneUrl: `file://${p}`,
          name,
          displayName: name,
          defaultBranch: await localDefaultBranch(p),
          isFork: false,
          isArchived: false,
          // Read-only: no zoekt.* git config is written, so zoekt names the repo from origin itself.
          metadata: { branches: config.revisions?.branches, tags: config.revisions?.tags },
        });
      }),
    ),
  );
  return repos;
}

/** http(s):// connections: one remote repo, verified with ls-remote. */
async function compileUrl(config: GenericGitHostConnectionConfig): Promise<RepoRecord[]> {
  const remote = new URL(config.url);
  try {
    if (!(await git(process.cwd(), ["ls-remote", "--heads", remote.toString()])).trim()) throw new Error("no heads");
  } catch {
    console.warn(`[git] skipping ${remote}: not a git repository`);
    return [];
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(remote.pathname);
  } catch {
    console.warn(`[git] skipping ${remote}: malformed URL encoding`);
    return [];
  }
  const name = joinName(remote.host, pathname.replace(/\.git$/, ""));
  return [
    {
      externalId: remote.toString(),
      codeHostType: "genericGitHost",
      codeHostUrl: remote.origin,
      cloneUrl: remote.toString(),
      name,
      displayName: name,
      defaultBranch: undefined,
      isFork: false,
      isArchived: false,
      metadata: {
        gitConfig: {
          "zoekt.name": name,
          "zoekt.web-url": remote.toString(),
          "zoekt.archived": marshalBool(false),
          "zoekt.fork": marshalBool(false),
          "zoekt.public": marshalBool(true),
          "zoekt.display-name": name,
        },
        branches: config.revisions?.branches,
        tags: config.revisions?.tags,
      },
    },
  ];
}

export async function compileGenericGit(config: GenericGitHostConnectionConfig): Promise<RepoRecord[]> {
  const protocol = new URL(config.url).protocol;
  if (protocol === "file:") return compileFile(config);
  if (protocol === "http:" || protocol === "https:") return compileUrl(config);
  throw new Error(`Unsupported protocol: ${protocol}`);
}

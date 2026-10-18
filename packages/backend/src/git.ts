import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const run = promisify(execFile);

function gitEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    // pass credentials via config env so they never land in .git/config or argv
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
  }
  return env;
}

async function git(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  const { stdout } = await run("git", args, { env, cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/** Clone bare on first sync, else fetch all heads. Returns repo metadata. */
export async function syncRepo(dir: string, url: string, token?: string) {
  const env = gitEnv(token);
  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(["clone", "--bare", "--", url, dir], env);
  } else {
    await git(["--git-dir", dir, "fetch", "--prune", "--", url, "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], env);
  }
  // `fetch` with explicit refspecs never moves a bare clone's HEAD, so follow the remote's default branch.
  try {
    const out = await git(["ls-remote", "--symref", "--", url, "HEAD"], env);
    const m = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(out);
    if (m) await git(["--git-dir", dir, "symbolic-ref", "HEAD", `refs/heads/${m[1]}`], env);
  } catch {
    /* empty remote or no symref support: keep the existing HEAD */
  }
  let defaultBranch: string | null = null;
  try {
    defaultBranch = await git(["--git-dir", dir, "symbolic-ref", "--short", "HEAD"], env);
  } catch {
    /* detached or empty repo */
  }
  const branches = (await git(["--git-dir", dir, "for-each-ref", "--format=%(refname:short)", "refs/heads"], env))
    .split("\n")
    .filter(Boolean);
  const tags = (await git(["--git-dir", dir, "for-each-ref", "--format=%(refname:short)", "refs/tags"], env))
    .split("\n")
    .filter(Boolean);
  let pushedAt: Date | null = null;
  try {
    pushedAt = new Date(await git(["--git-dir", dir, "log", "-1", "--format=%cI", "--all"], env));
  } catch {
    /* empty repo */
  }
  return { defaultBranch, branches, tags, pushedAt };
}

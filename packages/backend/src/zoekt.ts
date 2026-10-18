import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { env, repoDirName } from "@sbc/shared";

const run = promisify(execFile);

/**
 * Build/refresh the zoekt shards for one bare repo.
 * zoekt-git-index has no -name flag: the indexed repo name comes from the repo's
 * `zoekt.name` git config, and shard files get a deterministic prefix so we can delete them later.
 */
export async function indexRepo(name: string, gitDir: string, branches: string[]) {
  fs.mkdirSync(env.indexDir, { recursive: true });
  await run("git", ["--git-dir", gitDir, "config", "zoekt.name", name]);
  await run(
    "zoekt-git-index",
    [
      "-index", env.indexDir,
      "-shard_prefix_override", repoDirName(name),
      "-branches", branches.join(","),
      "-submodules=false",
      ...(process.env.ZOEKT_DISABLE_CTAGS === "1" ? ["-disable_ctags"] : []),
      gitDir,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}

/** Remove every shard (and meta file) written for a repo. */
export function removeShards(name: string) {
  if (!fs.existsSync(env.indexDir)) return;
  const prefix = repoDirName(name) + "_v";
  for (const f of fs.readdirSync(env.indexDir)) {
    if (f.startsWith(prefix)) fs.rmSync(path.join(env.indexDir, f), { force: true });
  }
}

import path from "node:path";

export const env = {
  get dataDir() {
    return path.resolve(process.env.DATA_DIR ?? "./data");
  },
  get reposDir() {
    return path.join(this.dataDir, "repos");
  },
  get indexDir() {
    return path.join(this.dataDir, "index");
  },
  get zoektUrl() {
    return process.env.ZOEKT_URL ?? "http://localhost:6070";
  },
  get redisUrl() {
    return process.env.REDIS_URL ?? "redis://localhost:6379";
  },
  get configPath() {
    return path.resolve(process.env.CONFIG_PATH ?? "./config.json");
  },
};

/**
 * Filesystem-safe directory name for a repo. Injective: `_` is itself escaped (to `_5F`) before
 * `%` becomes `_`, so "a/b" (`a_2Fb`) and a repo literally named "a_2Fb" (`a_5F2Fb`) cannot share a
 * directory. The git tools authorize by name and then read by directory, so a collision would let
 * one allowed repo read another's clone.
 */
export function repoDirName(name: string): string {
  return encodeURIComponent(name.replace(/_/g, "_5F")).replace(/%/g, "_");
}

export function repoGitDir(name: string): string {
  return path.join(env.reposDir, `${repoDirName(name)}.git`);
}

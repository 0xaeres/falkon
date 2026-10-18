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

/** Filesystem-safe, reversible-enough directory name for a repo. */
export function repoDirName(name: string): string {
  return encodeURIComponent(name).replace(/%/g, "_");
}

export function repoGitDir(name: string): string {
  return path.join(env.reposDir, `${repoDirName(name)}.git`);
}

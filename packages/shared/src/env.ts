import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "./config";

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
  /** The web process reads no settings; the history tools take the sync interval from here (same default as the backend setting). */
  get discussionSyncIntervalMs() {
    return Number(process.env.DISCUSSION_SYNC_INTERVAL_MS) || DEFAULT_SETTINGS.discussionSyncIntervalMs;
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

/** Where a repo's git data lives. File-URL generic-git repos are read in place and never written to. */
export function repoPath(repo: { id: number; cloneUrl: string; external_codeHostType: string; kind?: string; name: string }): {
  path: string;
  isReadOnly: boolean;
} {
  if (repo.kind === "KNOWLEDGE") return { path: repoGitDir(repo.name), isReadOnly: false };
  if (repo.external_codeHostType === "genericGitHost" && repo.cloneUrl.startsWith("file:")) {
    return { path: decodeURIComponent(new URL(repo.cloneUrl).pathname), isReadOnly: true };
  }
  return { path: path.join(env.reposDir, String(repo.id)), isReadOnly: false };
}

/** The directory to pass as --git-dir: `<path>/.git` for a working tree, else the path (bare). */
export function gitDirOf(p: string): string {
  const dotGit = path.join(p, ".git");
  return fs.existsSync(dotGit) ? dotGit : p;
}

export function repoGitDir(name: string): string {
  return path.join(env.reposDir, `${repoDirName(name)}.git`);
}

/** A knowledge repo is named after its owner so visibility can follow the owner's. */
export const KB_SUFFIX = "::knowledge";
export const knowledgeRepoName = (owner: string) => `${owner}${KB_SUFFIX}`;
export const ownerOfKnowledgeRepo = (name: string): string | undefined => (name.endsWith(KB_SUFFIX) ? name.slice(0, -KB_SUFFIX.length) : undefined);

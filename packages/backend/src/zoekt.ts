import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "@sbc/shared";

const run = promisify(execFile);

/** One tenant; only part of the shard prefix (upstream zoekt-git-index has no -tenant_id flag). */
export const TENANT_ID = 1;

export const DEFAULT_SETTINGS = {
  maxFileSize: 2 * 1024 * 1024, // bytes; larger files are not indexed
  maxTrigramCount: 20_000, // files with more distinct trigrams are skipped (minified blobs, data)
};

/** Shards are named by repo id, so a rename in config cannot orphan them. */
export const shardPrefix = (repoId: number) => `${TENANT_ID}_${repoId}`;

export interface ZoektRepoMeta {
  name: string;
  displayName?: string | null;
  webUrl?: string | null;
  isFork: boolean;
  isArchived: boolean;
  isPublic: boolean;
}

const flag = (b: boolean) => (b ? "1" : "0");

/**
 * zoekt-git-index reads repository metadata from the bare repo's git config (`zoekt.*`):
 * the indexed repo name, and the booleans behind the archived:/fork:/visibility: filters.
 */
export async function writeZoektGitConfig(gitDir: string, m: ZoektRepoMeta) {
  const entries: [string, string][] = [
    ["zoekt.name", m.name],
    ["zoekt.archived", flag(m.isArchived)],
    ["zoekt.fork", flag(m.isFork)],
    ["zoekt.public", flag(m.isPublic)],
  ];
  if (m.displayName) entries.push(["zoekt.display-name", m.displayName]);
  if (m.webUrl) entries.push(["zoekt.web-url", m.webUrl]);
  for (const [k, v] of entries) await run("git", ["--git-dir", gitDir, "config", k, v]);
}

/** Build/refresh the zoekt shards for one bare repo. `revisions` are full refs, e.g. refs/heads/main. */
export async function indexRepo(
  repoId: number,
  name: string,
  gitDir: string,
  revisions: string[],
  signal?: AbortSignal,
  settings: { maxFileSize: number; maxTrigramCount: number } = DEFAULT_SETTINGS,
) {
  fs.mkdirSync(env.indexDir, { recursive: true });
  const largeFiles = (process.env.ALWAYS_INDEX_FILE_PATTERNS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // Upstream zoekt-git-index names an in-place clone after its directory unless told otherwise;
  // -meta carries the registry name, which the indexer keeps when the repo has no zoekt.name.
  const metaDir = fs.mkdtempSync(path.join(os.tmpdir(), "zoekt-meta-"));
  try {
    const metaFile = path.join(metaDir, "meta.json");
    fs.writeFileSync(metaFile, JSON.stringify({ Name: name }));
    const args = [
      "-meta", metaFile,
      "-allow_missing_branches",
      "-index", env.indexDir,
      "-max_trigram_count", String(settings.maxTrigramCount),
      "-file_limit", String(settings.maxFileSize),
      "-branches", revisions.join(","),
      "-shard_prefix_override", shardPrefix(repoId),
      ...largeFiles.flatMap((p) => ["-large_file", p]),
      gitDir,
    ];
    return await run("zoekt-git-index", args, { maxBuffer: 16 * 1024 * 1024, signal });
  } finally {
    fs.rmSync(metaDir, { recursive: true, force: true });
  }
}

/** Remove every shard (and leftover .tmp file from an interrupted index) written for a repo. */
export function removeShards(repoId: number) {
  if (!fs.existsSync(env.indexDir)) return;
  const prefix = shardPrefix(repoId) + "_v";
  for (const f of fs.readdirSync(env.indexDir)) {
    if (f.startsWith(prefix)) fs.rmSync(path.join(env.indexDir, f), { force: true });
  }
}

import type { CodeHostType } from "@sbc/db";

/** What a code host contributes to `Repo.metadata`. */
export interface RepoMetadata {
  /** Written into the repo's git config as `zoekt.*`; zoekt-git-index reads it for name, URLs and flags. */
  gitConfig?: Record<string, string>;
  /** Branch / tag globs (from `revisions`) indexed besides the default branch. */
  branches?: string[];
  tags?: string[];
  /** Refs the last index covered; written by the index job. */
  indexedRevisions?: string[];
  codeHostMetadata?: {
    github?: { topics: string[] };
    gitlab?: { topics: string[] };
    bitbucketCloud?: { workspace: string; repoSlug: string };
    bitbucketServer?: { projectKey: string; repoSlug: string };
  };
}

/** One repository a connection discovered, keyed by (externalId, codeHostUrl). */
export interface RepoRecord {
  externalId: string;
  codeHostType: CodeHostType;
  codeHostUrl: string;
  name: string;
  displayName: string;
  cloneUrl: string;
  webUrl?: string | null;
  imageUrl?: string | null;
  /** Unknown until cloned for some hosts (gerrit, generic git); then taken from the clone's HEAD. */
  defaultBranch?: string | null;
  isFork: boolean;
  isArchived: boolean;
  isPublic?: boolean;
  metadata: RepoMetadata;
}

/** zoekt reads booleans from git config as "1" / "0". */
export const marshalBool = (v?: boolean | null) => (v ? "1" : "0");

/** The hostname-rooted prefix repo names start with: `https://host:port/` -> `host:port/`. */
export const repoNameRoot = (hostUrl: string) => new URL(hostUrl).toString().replace(/^https?:\/\//, "");

/** Joins like node's path.posix.join, which Sourcebot uses for repo names (so `a//b` collapses). */
export { join as joinName } from "node:path/posix";

export const trimSlashes = (url: string) => url.replace(/\/+$/, "");

/** Retries 5xx / 403 / 429 up to three attempts: honours x-ratelimit-reset, else 3s, 6s backoff. */
export async function fetchWithRetry<T>(fn: () => Promise<T>, what: string, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as { status?: number; response?: { headers?: Record<string, string> } };
      const status = err.status ?? 0;
      const retryable = (status >= 500 && status < 600) || status === 403 || status === 429;
      if (!retryable || attempt >= maxAttempts) throw e;
      const reset = err.response?.headers?.["x-ratelimit-reset"];
      const until = reset ? Number.parseInt(reset) * 1000 : Date.now() + 3000 * 2 ** (attempt - 1);
      console.warn(`[connectors] ${what}: HTTP ${status}, retrying (attempt ${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, Math.max(0, until - Date.now())));
    }
  }
}

/** Runs one lookup per target; a 404 skips the target (with a warning), any other failure fails the sync. */
export async function perTarget<T, R>(
  targets: T[],
  label: (t: T) => string,
  fn: (t: T) => Promise<R[]>,
  isNotFound: (e: unknown) => boolean,
): Promise<R[]> {
  const results = await Promise.allSettled(
    targets.map(async (t) => {
      try {
        return await fn(t);
      } catch (e) {
        if (isNotFound(e)) {
          console.warn(`[connectors] ${label(t)} not found or no access; skipped`);
          return [];
        }
        throw e;
      }
    }),
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export const statusIs = (code: number) => (e: unknown) => (e as { status?: number } | null)?.status === code;

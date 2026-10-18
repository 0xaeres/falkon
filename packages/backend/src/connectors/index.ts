import type { ConnectionConfig } from "@sbc/shared";
import { compileGenericGit } from "./genericGit";
import { compileGithub } from "./github";
import type { RepoRecord } from "./types";

export type { RepoMetadata, RepoRecord } from "./types";

/** Connection types this build syncs. The config schema accepts all of Sourcebot's; the rest fail the sync. */
export const SUPPORTED_CONNECTION_TYPES = ["github", "git"] as const;

/** Lists the repos a connection selects, applying its include/exclude rules. */
export function compileConnection(config: ConnectionConfig, signal?: AbortSignal): Promise<RepoRecord[]> {
  switch (config.type) {
    case "github":
      return compileGithub(config, signal);
    case "git":
      return compileGenericGit(config);
    default:
      return Promise.reject(new Error(`connection type "${config.type}" is not supported (supported: ${SUPPORTED_CONNECTION_TYPES.join(", ")})`));
  }
}

/** First record wins per (externalId, codeHostUrl), as a connection can list a repo twice (org + repos). */
export const dedupeRecords = (records: RepoRecord[]) =>
  records.filter((r, i) => i === records.findIndex((o) => o.externalId === r.externalId && o.codeHostUrl === r.codeHostUrl));

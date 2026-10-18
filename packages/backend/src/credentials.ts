import { getTokenFromConfig, type ConnectionConfig } from "@sbc/shared";
import type { GitCredentials } from "./git";

/**
 * Git HTTP credentials for a repo: the token of the first linked GitHub connection that has one,
 * as GitHub's `x-access-token` basic auth.
 */
export async function credentialsFor(codeHostType: string, connections: { config: unknown }[]): Promise<GitCredentials | undefined> {
  if (codeHostType === "github" && process.env.EXPERIMENT_ASK_GH_GITHUB_TOKEN) {
    return { username: "x-access-token", password: process.env.EXPERIMENT_ASK_GH_GITHUB_TOKEN };
  }
  for (const { config } of connections) {
    const c = config as ConnectionConfig;
    // Only GitHub connections are synced (generic git has no token).
    if (c.type === "github" && c.token) return { username: "x-access-token", password: await getTokenFromConfig(c.token) };
  }
  return undefined;
}
